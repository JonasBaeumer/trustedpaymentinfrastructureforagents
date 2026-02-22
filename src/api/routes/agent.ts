import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { workerAuthMiddleware } from '@/api/middleware/auth';
import { agentQuoteSchema, agentResultSchema } from '@/api/validators/agent';
import { IntentStatus } from '@/contracts';
import { receiveQuote, requestApproval, completeCheckout, failCheckout } from '@/orchestrator/intentService';
import { settleIntent, returnIntent } from '@/ledger/potService';
import { revealCard, cancelCard } from '@/payments/cardService';
import { prisma } from '@/db/client';
import { sendApprovalRequest } from '@/telegram/notificationService';

export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/agent/quote — worker posts search result
  // Flow: SEARCHING → QUOTED → AWAITING_APPROVAL
  fastify.post('/v1/agent/quote', {
    preHandler: workerAuthMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = agentQuoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.errors });
    }

    const { intentId, merchantName, merchantUrl, price, currency } = parsed.data;
    const intent = await prisma.purchaseIntent.findUnique({ where: { id: intentId } });
    if (!intent) return reply.status(404).send({ error: `Intent not found: ${intentId}` });
    if (intent.status !== IntentStatus.SEARCHING) {
      return reply.status(409).send({ error: `Intent must be in SEARCHING state (current: ${intent.status})` });
    }

    // SEARCHING → QUOTED (stores quote data in metadata via orchestrator)
    await receiveQuote(intentId, { merchantName, merchantUrl, price, currency });

    // QUOTED → AWAITING_APPROVAL
    await requestApproval(intentId);

    // Fire-and-forget Telegram notification — must not block the HTTP response
    sendApprovalRequest(intentId).catch((err: unknown) =>
      fastify.log.error({ message: 'Telegram notification failed', intentId, error: String(err) })
    );

    return reply.send({ intentId, status: IntentStatus.AWAITING_APPROVAL });
  });

  // POST /v1/agent/result — worker posts checkout outcome
  // Flow on success: CHECKOUT_RUNNING → DONE, settle ledger, cancel card
  // Flow on failure: CHECKOUT_RUNNING → FAILED, return ledger funds, cancel card
  fastify.post('/v1/agent/result', {
    preHandler: workerAuthMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = agentResultSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.errors });
    }

    const { intentId, success, actualAmount, receiptUrl, errorMessage } = parsed.data;
    const intent = await prisma.purchaseIntent.findUnique({ where: { id: intentId } });
    if (!intent) return reply.status(404).send({ error: `Intent not found: ${intentId}` });
    if (intent.status !== IntentStatus.CHECKOUT_RUNNING) {
      return reply.status(409).send({ error: `Intent must be in CHECKOUT_RUNNING state (current: ${intent.status})` });
    }

    if (success) {
      await completeCheckout(intentId, actualAmount ?? 0);
      await settleIntent(intentId, actualAmount ?? 0);
    } else {
      await failCheckout(intentId, errorMessage ?? 'Checkout failed');
      await returnIntent(intentId);
    }

    // Cancel the virtual card — one purchase, one card (best-effort)
    await cancelCard(intentId).catch(() => {});

    // Store receipt/error info in metadata
    await prisma.purchaseIntent.update({
      where: { id: intentId },
      data: { metadata: { ...(intent.metadata as object), actualAmount, receiptUrl, errorMessage } as any },
    });

    const finalStatus = success ? IntentStatus.DONE : IntentStatus.FAILED;
    return reply.send({ intentId, status: finalStatus });
  });

  // GET /v1/agent/decision/:intentId — poll for approval decision + card details
  // Returns AWAITING_APPROVAL, DENIED, or APPROVED (with one-time card on first call)
  fastify.get('/v1/agent/decision/:intentId', {
    preHandler: workerAuthMiddleware,
  }, async (request: FastifyRequest<{ Params: { intentId: string } }>, reply: FastifyReply) => {
    const { intentId } = request.params;

    const intent = await prisma.purchaseIntent.findUnique({
      where: { id: intentId },
      include: { virtualCard: true },
    });
    if (!intent) return reply.status(404).send({ error: `Intent not found: ${intentId}` });

    switch (intent.status) {
      case IntentStatus.AWAITING_APPROVAL:
        return reply.send({ intentId, status: IntentStatus.AWAITING_APPROVAL });

      case IntentStatus.DENIED:
        return reply.send({ intentId, status: IntentStatus.DENIED });

      case IntentStatus.CARD_ISSUED:
      case IntentStatus.CHECKOUT_RUNNING:
      case IntentStatus.DONE: {
        if (!intent.virtualCard || intent.virtualCard.revealedAt !== null) {
          return reply.send({ intentId, status: IntentStatus.APPROVED });
        }
        try {
          const reveal = await revealCard(intentId);
          return reply.send({ intentId, status: IntentStatus.APPROVED, card: reveal });
        } catch (err: any) {
          if (err.name === 'CardAlreadyRevealedError') {
            return reply.send({ intentId, status: IntentStatus.APPROVED });
          }
          throw err;
        }
      }

      case IntentStatus.APPROVED:
        // Brief transition between recordDecision and issueVirtualCard — keep polling
        return reply.send({ intentId, status: IntentStatus.AWAITING_APPROVAL });

      default:
        return reply.send({ intentId, status: intent.status });
    }
  });

  // GET /v1/agent/card/:intentId — one-time card reveal via Stripe
  // cardService enforces the single-reveal rule and fetches PAN/CVC from Stripe
  fastify.get('/v1/agent/card/:intentId', {
    preHandler: workerAuthMiddleware,
  }, async (request: FastifyRequest<{ Params: { intentId: string } }>, reply: FastifyReply) => {
    const { intentId } = request.params;

    try {
      const reveal = await revealCard(intentId);
      return reply.send({ intentId, ...reveal });
    } catch (err: any) {
      if (err.name === 'CardAlreadyRevealedError') {
        return reply.status(409).send({ error: 'Card has already been revealed' });
      }
      if (err.name === 'IntentNotFoundError') {
        return reply.status(404).send({ error: `No card found for intent: ${intentId}` });
      }
      throw err;
    }
  });
}
