import Fastify from 'fastify';
import { intentRoutes } from '@/api/routes/intents';
import { approvalRoutes } from '@/api/routes/approvals';
import { agentRoutes } from '@/api/routes/agent';
import { webhookRoutes } from '@/api/routes/webhooks';
import { debugRoutes } from '@/api/routes/debug';
import { telegramRoutes } from '@/api/routes/telegram';
import { checkoutRoutes } from '@/api/routes/checkout';

export function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // Register raw body parser for Stripe webhooks BEFORE other parsers
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const parsed = JSON.parse(body.toString());
        done(null, parsed);
      } catch (err) {
        // For webhook route, pass raw buffer
        done(null, body);
      }
    }
  );

  // Register routes
  fastify.register(intentRoutes);
  fastify.register(approvalRoutes);
  fastify.register(agentRoutes);
  fastify.register(webhookRoutes);
  fastify.register(debugRoutes);
  fastify.register(telegramRoutes);
  fastify.register(checkoutRoutes);

  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  return fastify;
}
