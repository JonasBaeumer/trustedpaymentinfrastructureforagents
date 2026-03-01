jest.mock('@/config/env', () => ({
  env: {
    WORKER_API_KEY: 'test-worker-key',
    PORT: 3000,
    NODE_ENV: 'test',
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
    DATABASE_URL: 'postgresql://test',
    REDIS_URL: 'redis://localhost:6379',
  },
}));

jest.mock('@/db/client', () => ({
  prisma: {
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}));

jest.mock('@/payments/providers/stripe/stripeClient', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: jest.fn() },
    issuing: { authorizations: { approve: jest.fn().mockResolvedValue({}) } },
  }),
}));

import { buildApp } from '@/app';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Stripe webhook endpoint', () => {
  it('400 when stripe-signature header is missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'issuing_authorization.created' }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('stripe-signature');
  });

  it('200 with received:true when stripe-signature present', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'sig-test' },
      body: JSON.stringify({ type: 'issuing_authorization.created' }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: true });
  });
});

describe('Health check', () => {
  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
  });
});
