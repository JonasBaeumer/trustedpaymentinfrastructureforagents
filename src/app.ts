import Fastify from 'fastify';
import { intentRoutes } from '@/api/routes/intents';
import { approvalRoutes } from '@/api/routes/approvals';
import { agentRoutes } from '@/api/routes/agent';
import { webhookRoutes } from '@/api/routes/webhooks';
import { debugRoutes } from '@/api/routes/debug';
import { telegramRoutes } from '@/api/routes/telegram';
import { checkoutRoutes } from '@/api/routes/checkout';
import { usersRoutes } from '@/api/routes/users';

export function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // Register content-type parser: for Stripe webhook path pass raw buffer (required for
  // signature verification); for all other application/json parse as JSON.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      const path = req.url?.split('?')[0];
      if (path === '/v1/webhooks/stripe') {
        done(null, body);
        return;
      }
      try {
        done(null, JSON.parse(body.toString()));
      } catch (err) {
        done(err as Error, undefined);
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
  fastify.register(usersRoutes);

  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  return fastify;
}
