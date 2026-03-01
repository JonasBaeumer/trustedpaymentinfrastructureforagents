import 'dotenv/config';
import { buildApp } from '@/app';
import { env } from '@/config/env';
import { validateStripeSetup } from '@/payments/providers/stripe/validateStripe';

async function start() {
  const app = buildApp();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(JSON.stringify({ level: 'info', message: `Server running on port ${env.PORT}` }));
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', message: 'Server failed to start', error: String(err) }));
    process.exit(1);
  }

  await validateStripeSetup();
}

start();
