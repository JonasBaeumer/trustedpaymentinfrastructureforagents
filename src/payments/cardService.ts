import Stripe from 'stripe';
import { getStripeClient } from './stripeClient';
import { buildSpendingControls } from './spendingControls';
import { prisma } from '@/db/client';
import { VirtualCardData, CardReveal, CardAlreadyRevealedError, IntentNotFoundError } from '@/contracts';

interface IssueCardOptions {
  mccAllowlist?: string[];
}

export async function issueVirtualCard(
  intentId: string,
  amount: number,
  currency: string,
  options: IssueCardOptions = {},
): Promise<VirtualCardData> {
  const stripe = getStripeClient();

  const intent = await prisma.purchaseIntent.findUnique({
    where: { id: intentId },
    include: { user: true },
  });
  if (!intent) throw new IntentNotFoundError(intentId);

  // Create a cardholder for this intent (no upsert — User model lacks stripeCardholderId)
  let cardholder: Stripe.Issuing.Cardholder;
  try {
    cardholder = await stripe.issuing.cardholders.create({
      name: 'Agent Buyer',
      email: intent.user.email,
      type: 'individual',
      billing: {
        address: {
          line1: '1 Agent St',
          city: 'London',
          postal_code: 'EC1A 1BB',
          country: 'GB',
        },
      },
    });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(JSON.stringify({ level: 'error', message: 'Cardholder create failed', type: err.type, code: err.code, intentId }));
    }
    throw err;
  }

  // Create virtual card with intentId as idempotency key
  let stripeCard: Stripe.Issuing.Card;
  try {
    stripeCard = await stripe.issuing.cards.create(
      {
        cardholder: cardholder.id,
        currency: currency.toLowerCase(),
        type: 'virtual',
        spending_controls: buildSpendingControls(amount, options.mccAllowlist),
      },
      { idempotencyKey: intentId },
    );
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(JSON.stringify({ level: 'error', message: 'Card create failed', type: err.type, code: err.code, intentId }));
    }
    throw err;
  }

  // Persist ONLY stripeCardId + last4 — never PAN, CVC
  const virtualCard = await prisma.virtualCard.create({
    data: {
      intentId,
      stripeCardId: stripeCard.id,
      last4: stripeCard.last4,
    },
  });

  return virtualCard as unknown as VirtualCardData;
}

export async function revealCard(intentId: string): Promise<CardReveal> {
  const stripe = getStripeClient();

  const card = await prisma.virtualCard.findUnique({ where: { intentId } });
  if (!card) throw new IntentNotFoundError(intentId);
  if (card.revealedAt) throw new CardAlreadyRevealedError(intentId);

  // Retrieve card with expanded number and CVC (test mode only)
  let stripeCard: Stripe.Issuing.Card;
  try {
    stripeCard = await stripe.issuing.cards.retrieve(card.stripeCardId, {
      expand: ['number', 'cvc'],
    });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(JSON.stringify({ level: 'error', message: 'Failed to retrieve card details', type: err.type, code: err.code, intentId }));
    }
    throw err;
  }

  // Mark as revealed — destructive, one-time only
  await prisma.virtualCard.update({
    where: { intentId },
    data: { revealedAt: new Date() },
  });

  return {
    number: (stripeCard as any).number ?? '',
    cvc: (stripeCard as any).cvc ?? '',
    expMonth: stripeCard.exp_month,
    expYear: stripeCard.exp_year,
    last4: stripeCard.last4,
  };
}

export async function freezeCard(intentId: string): Promise<void> {
  const stripe = getStripeClient();

  const card = await prisma.virtualCard.findUnique({ where: { intentId } });
  if (!card) throw new IntentNotFoundError(intentId);

  try {
    await stripe.issuing.cards.update(card.stripeCardId, { status: 'inactive' });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(JSON.stringify({ level: 'error', message: 'Failed to freeze card', type: err.type, code: err.code, intentId }));
    }
    throw err;
  }

  await prisma.virtualCard.update({
    where: { intentId },
    data: { frozenAt: new Date() },
  });
}

export async function cancelCard(intentId: string): Promise<void> {
  const stripe = getStripeClient();

  const card = await prisma.virtualCard.findUnique({ where: { intentId } });
  if (!card) throw new IntentNotFoundError(intentId);

  try {
    await stripe.issuing.cards.update(card.stripeCardId, { status: 'canceled' });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(JSON.stringify({ level: 'error', message: 'Failed to cancel card', type: err.type, code: err.code, intentId }));
    }
    throw err;
  }

  await prisma.virtualCard.update({
    where: { intentId },
    data: { cancelledAt: new Date() },
  });
}
