import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/db/client';
import { idempotencyMiddleware, saveIdempotencyResponse } from '@/api/middleware/idempotency';
import { createIntentSchema } from '@/api/validators/intents';
import { IntentStatus } from '@/contracts';

export async function intentRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/intents
  fastify.post('/v1/intents', {
    preHandler: idempotencyMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const idempotencyKey = request.headers['x-idempotency-key'] as string;
    if (!idempotencyKey) {
      return reply.status(400).send({ error: 'X-Idempotency-Key header is required' });
    }

    const parsed = createIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.errors });
    }

    const { userId, query, maxBudget, currency, expiresAt } = parsed.data;

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({ error: `User not found: ${userId}` });
    }

    const intent = await prisma.purchaseIntent.create({
      data: {
        userId,
        query,
        maxBudget,
        currency,
        status: IntentStatus.RECEIVED,
        idempotencyKey,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    const responseBody = { intentId: intent.id, status: intent.status, createdAt: intent.createdAt };
    await saveIdempotencyResponse(idempotencyKey, responseBody);

    return reply.status(201).send(responseBody);
  });

  // GET /v1/intents/:intentId
  fastify.get('/v1/intents/:intentId', async (request: FastifyRequest<{ Params: { intentId: string } }>, reply: FastifyReply) => {
    const { intentId } = request.params;
    const intent = await prisma.purchaseIntent.findUnique({
      where: { id: intentId },
      include: { virtualCard: true, auditEvents: { orderBy: { createdAt: 'asc' } } },
    });

    if (!intent) {
      return reply.status(404).send({ error: `Intent not found: ${intentId}` });
    }

    return reply.send({ intent });
  });
}
