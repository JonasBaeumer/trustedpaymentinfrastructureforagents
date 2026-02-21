import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { idempotencyMiddleware, saveIdempotencyResponse } from '@/api/middleware/idempotency';
import { approvalDecisionSchema } from '@/api/validators/approvals';
import { prisma } from '@/db/client';
import { IntentStatus } from '@/contracts';

export async function approvalRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/approvals/:intentId/decision', {
    preHandler: idempotencyMiddleware,
  }, async (request: FastifyRequest<{ Params: { intentId: string } }>, reply: FastifyReply) => {
    const idempotencyKey = request.headers['x-idempotency-key'] as string;
    if (!idempotencyKey) {
      return reply.status(400).send({ error: 'X-Idempotency-Key header is required' });
    }

    const { intentId } = request.params;
    const parsed = approvalDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.errors });
    }

    const intent = await prisma.purchaseIntent.findUnique({ where: { id: intentId } });
    if (!intent) {
      return reply.status(404).send({ error: `Intent not found: ${intentId}` });
    }

    if (intent.status !== IntentStatus.AWAITING_APPROVAL) {
      return reply.status(409).send({ error: `Intent is not in AWAITING_APPROVAL state (current: ${intent.status})` });
    }

    const { decision, actorId, reason } = parsed.data;

    // Record decision
    await prisma.approvalDecision.upsert({
      where: { intentId },
      update: {},
      create: { intentId, decision: decision as any, actorId, reason },
    });

    // Transition state
    const newStatus = decision === 'APPROVED' ? IntentStatus.APPROVED : IntentStatus.DENIED;
    await prisma.purchaseIntent.update({ where: { id: intentId }, data: { status: newStatus } });
    await prisma.auditEvent.create({
      data: { intentId, actor: actorId, event: decision === 'APPROVED' ? 'USER_APPROVED' : 'USER_DENIED', payload: { reason } },
    });

    const responseBody = { intentId, decision, status: newStatus };
    await saveIdempotencyResponse(idempotencyKey, responseBody);

    return reply.send(responseBody);
  });
}
