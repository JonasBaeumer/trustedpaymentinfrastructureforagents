/**
 * E2E: Telegram approval → Stripe Issuing checkout
 *
 * Simulates what OpenClaw does end-to-end — without a real agent:
 *
 *  1. Create a test user linked to TELEGRAM_TEST_CHAT_ID
 *  2. Create a purchase intent (seeded into QUOTED state)
 *  3. Transition to AWAITING_APPROVAL + send a REAL Telegram approval request
 *  4. Wait up to 60 s for the user to tap "Approve" in Telegram
 *     (requires: npm run dev + Telegram webhook via ngrok pointing to localhost:3000)
 *  5. If no approval received, auto-approve after the timeout
 *  6. Issue the Stripe virtual card
 *  7. Wait 3 s for the fresh cardholder's verification state to settle
 *  8. Create a Stripe test authorization + capture (the simulated checkout)
 *  9. Finalize the intent + settle the ledger
 * 10. Assert: status = DONE, pot SETTLED, balance arithmetic correct
 *
 * Requires:
 *   STRIPE_SECRET_KEY=sk_test_*
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_TEST_CHAT_ID
 *
 * Run: npx jest --testPathPattern=telegramApprovalCheckout --forceExit
 */

import { prisma } from '@/db/client';
import { getRedisClient } from '@/config/redis';
import { requestApproval, recordDecision } from '@/approval/approvalService';
import { sendApprovalRequest } from '@/telegram/notificationService';
import { issueVirtualCard } from '@/payments/cardService';
import { reserveForIntent, settleIntent } from '@/ledger/potService';
import {
  markCardIssued,
  startCheckout,
  completeCheckout,
} from '@/orchestrator/intentService';
import { getStripeClient } from '@/payments/stripeClient';
import { IntentStatus, ApprovalDecisionType } from '@/contracts';

// ─── Skip conditions ─────────────────────────────────────────────────────────
const hasStripeKey = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
const hasTelegram =
  !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_TEST_CHAT_ID;

const testSuite = hasStripeKey && hasTelegram ? describe : describe.skip;

if (!hasStripeKey) console.warn('⚠️  Skipped: STRIPE_SECRET_KEY must be sk_test_*');
if (!hasTelegram)
  console.warn('⚠️  Skipped: TELEGRAM_BOT_TOKEN and TELEGRAM_TEST_CHAT_ID must be set');

// ─── Test data ────────────────────────────────────────────────────────────────
const RUN_ID = Date.now();
const MERCHANT_NAME = 'Amazon DE';
const TASK = 'Buy a pair of noise-cancelling headphones';
const MAX_BUDGET = 5000; // €50 in cents
const CHECKOUT_AMOUNT = 3499; // €34.99 — simulated actual price
const CURRENCY = 'eur';

// Telegram approval timeout: 60 s. If the user approves within this window
// (by tapping "Approve" in the bot message), the test proceeds automatically.
// If not, the test auto-approves so it can still demonstrate the checkout path.
const APPROVAL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

// ─── Teardown ─────────────────────────────────────────────────────────────────
afterAll(async () => {
  await prisma.$disconnect();
  getRedisClient().disconnect();
});

// ─── Suite ────────────────────────────────────────────────────────────────────
testSuite('Telegram approval → Stripe Issuing checkout', () => {
  let userId: string;
  let intentId: string;

  afterAll(async () => {
    await prisma.virtualCard.deleteMany({ where: { intentId } });
    await prisma.ledgerEntry.deleteMany({ where: { intentId } });
    await prisma.pot.deleteMany({ where: { intentId } });
    await prisma.approvalDecision.deleteMany({ where: { intentId } });
    await prisma.auditEvent.deleteMany({ where: { intentId } });
    await prisma.purchaseIntent.deleteMany({ where: { id: intentId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  // ─── Step 1 — Create test user ──────────────────────────────────────────────
  it('creates a test user linked to the Telegram chat', async () => {
    const user = await prisma.user.create({
      data: {
        email: `tg-checkout-${RUN_ID}@example.com`,
        telegramChatId: process.env.TELEGRAM_TEST_CHAT_ID!,
        mainBalance: 1_000_000, // €10 000
        maxBudgetPerIntent: 500_000,
      },
    });
    userId = user.id;
    expect(user.telegramChatId).toBe(process.env.TELEGRAM_TEST_CHAT_ID);
  });

  // ─── Step 2 — Create purchase intent ────────────────────────────────────────
  it('creates a purchase intent in QUOTED state', async () => {
    const intent = await prisma.purchaseIntent.create({
      data: {
        userId,
        query: TASK,
        subject: TASK,
        maxBudget: MAX_BUDGET,
        currency: CURRENCY,
        status: IntentStatus.QUOTED,
        idempotencyKey: `tg-checkout-${RUN_ID}`,
        metadata: {
          quote: {
            merchant: MERCHANT_NAME,
            url: 'https://amazon.de/dp/B09XS7JWHH',
            price: CHECKOUT_AMOUNT,
            currency: CURRENCY,
          },
        },
      },
    });
    intentId = intent.id;
    expect(intent.status).toBe(IntentStatus.QUOTED);
  });

  // ─── Step 3 — Request approval + send Telegram notification ─────────────────
  it('transitions to AWAITING_APPROVAL and sends a real Telegram message', async () => {
    await requestApproval(intentId);

    const intent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(intent.status).toBe(IntentStatus.AWAITING_APPROVAL);

    // Send the real Telegram approval request (fire-and-forget, non-throwing)
    await sendApprovalRequest(intentId);

    console.log(
      `\n📱 Telegram approval request sent!\n` +
        `   Tap "Approve" in your bot within ${APPROVAL_TIMEOUT_MS / 1000}s.\n` +
        `   (If not approved in time, the test will auto-approve.)\n`,
    );
  });

  // ─── Step 4 — Wait for Telegram approval (or auto-approve) ──────────────────
  it(
    'waits for user approval (or auto-approves after timeout)',
    async () => {
      const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
      let telegramApproved = false;
      let currentStatus: IntentStatus = IntentStatus.AWAITING_APPROVAL;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const intent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } });
        currentStatus = intent.status as IntentStatus;

        if (currentStatus === IntentStatus.APPROVED) {
          // User approved via Telegram; server is still issuing the card — keep polling
          if (!telegramApproved) {
            telegramApproved = true;
            console.log('✅ Approved via Telegram! Waiting for card to be issued...');
          }
          continue;
        }

        if (
          currentStatus === IntentStatus.CARD_ISSUED ||
          currentStatus === IntentStatus.CHECKOUT_RUNNING
        ) {
          console.log(`💳 Card issued! Intent status: ${currentStatus}`);
          break;
        }
      }

      if (!telegramApproved && currentStatus === IntentStatus.AWAITING_APPROVAL) {
        // No Telegram approval received within the timeout — auto-approve
        console.log('⏱  Timeout — auto-approving and continuing...');
        await recordDecision(intentId, ApprovalDecisionType.APPROVED, 'test-auto-approve');
        await reserveForIntent(userId, intentId, MAX_BUDGET);
        await issueVirtualCard(intentId, MAX_BUDGET, CURRENCY);
        await markCardIssued(intentId);
        await startCheckout(intentId);
        currentStatus = IntentStatus.CHECKOUT_RUNNING;
      } else if (telegramApproved && currentStatus === IntentStatus.APPROVED) {
        // Approved via Telegram but card issuance didn't complete within the window
        // Give the server a few extra seconds
        console.log('⏳ Card issuance still in progress, waiting 5 s...');
        await new Promise((r) => setTimeout(r, 5000));
        const intent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } });
        currentStatus = intent.status as IntentStatus;
      }

      const intent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } });
      expect([
        IntentStatus.CARD_ISSUED,
        IntentStatus.CHECKOUT_RUNNING,
      ]).toContain(intent.status);
    },
    APPROVAL_TIMEOUT_MS + 30_000,
  );

  // ─── Step 5 — Verify card was issued ────────────────────────────────────────
  it('has a real Stripe Issuing card in the database', async () => {
    const card = await prisma.virtualCard.findUniqueOrThrow({ where: { intentId } });
    expect(card.stripeCardId).toMatch(/^ic_/);
    expect(card.last4).toHaveLength(4);

    const stripe = getStripeClient();
    const stripeCard = await stripe.issuing.cards.retrieve(card.stripeCardId);
    expect(stripeCard.status).toBe('active');
    expect(stripeCard.spending_controls.spending_limits[0].amount).toBe(MAX_BUDGET);

    console.log(
      `💳 Card issued: ${stripeCard.id} (last4: ${stripeCard.last4}, status: ${stripeCard.status})`,
    );
  });

  // ─── Step 6 — Simulated checkout via Stripe test helpers ────────────────────
  it(
    'creates a real Stripe authorization and captures it (simulated checkout)',
    async () => {
      // Stripe test mode: freshly created individual cardholders need ~3 s to
      // settle before authorizations are approved (cardholder_verification_required
      // is returned during the settling window).
      console.log('⏳ Waiting 3 s for cardholder verification to settle...');
      await new Promise((r) => setTimeout(r, 3000));

      const card = await prisma.virtualCard.findUniqueOrThrow({ where: { intentId } });
      const stripe = getStripeClient();

      // Create a test authorization for the actual checkout amount
      const auth = await stripe.testHelpers.issuing.authorizations.create({
        card: card.stripeCardId,
        amount: CHECKOUT_AMOUNT,
        currency: CURRENCY,
        merchant_data: { name: MERCHANT_NAME },
      });

      expect(auth.approved).toBe(true);
      expect(auth.status).toBe('pending');
      console.log(
        `🛒 Authorization approved: ${auth.id} (€${(CHECKOUT_AMOUNT / 100).toFixed(2)})`,
      );

      // Capture settles the authorization → creates an issuing_transaction
      const captured = await stripe.testHelpers.issuing.authorizations.capture(auth.id);
      expect(captured.status).toBe('closed');
      console.log(`✅ Transaction captured. Check Stripe Dashboard → Issuing → Transactions`);
    },
    30_000,
  );

  // ─── Step 7 — Finalize intent + settle ledger ────────────────────────────────
  it('finalizes the intent and settles the ledger', async () => {
    // Ensure the intent is in CHECKOUT_RUNNING before completing
    const pre = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } });
    if (pre.status === IntentStatus.CARD_ISSUED) {
      await startCheckout(intentId);
    }

    await completeCheckout(intentId, CHECKOUT_AMOUNT);
    await settleIntent(intentId, CHECKOUT_AMOUNT);

    const intent = await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(intent.status).toBe(IntentStatus.DONE);

    // Verify the pot is SETTLED and balance arithmetic is correct
    const pot = await prisma.pot.findFirstOrThrow({ where: { intentId } });
    expect(pot.status).toBe('SETTLED');
    expect(pot.settledAmount).toBe(CHECKOUT_AMOUNT);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const surplus = MAX_BUDGET - CHECKOUT_AMOUNT;
    // mainBalance = 1_000_000 - MAX_BUDGET (reserved) + CHECKOUT_AMOUNT (settled) + surplus (returned)
    // = 1_000_000 - MAX_BUDGET + MAX_BUDGET = 1_000_000
    // Actually: settled returns the surplus automatically
    expect(user.mainBalance).toBe(1_000_000 - CHECKOUT_AMOUNT);

    console.log(
      `\n🎉 Flow complete!\n` +
        `   Intent: ${intentId} → ${intent.status}\n` +
        `   Charged: €${(CHECKOUT_AMOUNT / 100).toFixed(2)}\n` +
        `   Surplus returned: €${(surplus / 100).toFixed(2)}\n` +
        `   New balance: €${(user.mainBalance / 100).toFixed(2)}\n`,
    );
  });
});
