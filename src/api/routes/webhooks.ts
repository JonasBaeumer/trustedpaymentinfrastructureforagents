import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/db/client';

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/webhooks/stripe', async (request: FastifyRequest, reply: FastifyReply) => {
    // Signature verification and event handling is delegated to the payments module (Agent 4)
    // This route forwards the raw body to the webhook handler
    const signature = request.headers['stripe-signature'] as string;
    if (!signature) {
      return reply.status(400).send({ error: 'Missing stripe-signature header' });
    }

    try {
      // The payments module will be wired in by Agent 4
      // For now, log the event and return 200
      const body = request.body as Buffer | string;
      await prisma.auditEvent.create({
        data: {
          intentId: 'system',
          actor: 'stripe',
          event: 'WEBHOOK_RECEIVED',
          payload: { hasSignature: !!signature, bodyLength: Buffer.isBuffer(body) ? body.length : String(body).length },
        },
      }).catch(() => {
        // Ignore DB errors for system events without intentId
      });
    } catch {
      // Silent catch — always return 200 to Stripe
    }

    return reply.send({ received: true });
  });
}
