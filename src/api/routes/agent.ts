import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { workerAuthMiddleware } from '@/api/middleware/auth';
import { agentQuoteSchema, agentResultSchema } from '@/api/validators/agent';
import { prisma } from '@/db/client';
import { IntentStatus } from '@/contracts';

export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/agent/quote
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

    await prisma.purchaseIntent.update({
      where: { id: intentId },
      data: {
        status: IntentStatus.AWAITING_APPROVAL,
        metadata: { merchantName, merchantUrl, price, currency } as any,
      },
    });
    await prisma.auditEvent.create({
      data: { intentId, actor: 'worker', event: 'QUOTE_RECEIVED', payload: { merchantName, merchantUrl, price, currency } },
    });

    return reply.send({ intentId, status: IntentStatus.AWAITING_APPROVAL });
  });

  // POST /v1/agent/result
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

    const newStatus = success ? IntentStatus.DONE : IntentStatus.FAILED;
    await prisma.purchaseIntent.update({
      where: { id: intentId },
      data: { status: newStatus, metadata: { ...(intent.metadata as object), actualAmount, receiptUrl, errorMessage } as any },
    });
    await prisma.auditEvent.create({
      data: { intentId, actor: 'worker', event: success ? 'CHECKOUT_SUCCEEDED' : 'CHECKOUT_FAILED', payload: { actualAmount, receiptUrl, errorMessage } },
    });

    return reply.send({ intentId, status: newStatus });
  });

  // GET /v1/agent/card/:intentId
  fastify.get('/v1/agent/card/:intentId', {
    preHandler: workerAuthMiddleware,
  }, async (request: FastifyRequest<{ Params: { intentId: string } }>, reply: FastifyReply) => {
    const { intentId } = request.params;
    const card = await prisma.virtualCard.findUnique({ where: { intentId } });
    if (!card) return reply.status(404).send({ error: `No card found for intent: ${intentId}` });
    if (card.revealedAt) return reply.status(409).send({ error: 'Card has already been revealed' });

    await prisma.virtualCard.update({ where: { intentId }, data: { revealedAt: new Date() } });
    // In real implementation, fetch from Stripe. Return placeholder for now.
    return reply.send({
      intentId,
      stripeCardId: card.stripeCardId,
      last4: card.last4,
      // Stripe card details would be fetched here in production
      note: 'Full card details fetched from Stripe in production via cardService.revealCard()',
    });
  });
}
