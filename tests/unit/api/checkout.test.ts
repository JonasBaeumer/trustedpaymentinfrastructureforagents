// Mock env config (required by buildApp)
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

// Mock all route-level dependencies so we get a minimal app
jest.mock('@/orchestrator/intentService', () => ({}));
jest.mock('@/queue/producers', () => ({}));
jest.mock('@/approval/approvalService', () => ({}));
jest.mock('@/ledger/potService', () => ({}));
jest.mock('@/payments/cardService', () => ({}));
jest.mock('@/payments/stripeClient', () => ({
  getStripeClient: () => ({ webhooks: { constructEvent: jest.fn() } }),
}));
jest.mock('@/telegram/notificationService', () => ({}));
jest.mock('@/db/client', () => ({ prisma: {} }));

// ─── Mock runSimulatedCheckout ────────────────────────────────────────────────
const mockRunSimulatedCheckout = jest.fn();
jest.mock('@/payments/checkoutSimulator', () => ({
  runSimulatedCheckout: mockRunSimulatedCheckout,
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

beforeEach(() => jest.clearAllMocks());

const validBody = {
  cardNumber: '4242424242424242',
  cvc: '123',
  expMonth: 12,
  expYear: 2027,
  amount: 5000,
  currency: 'eur',
  merchantName: 'Amazon DE',
};

// ─── Validation errors (400) ──────────────────────────────────────────────────

describe('POST /v1/checkout/simulate — 400 validation', () => {
  it('returns 400 when cardNumber is missing', async () => {
    const { cardNumber: _cn, ...body } = validBody;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when cvc has invalid format (letters)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, cvc: 'abc' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when cvc is too short (2 digits)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, cvc: '12' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when expYear is in the past', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, expYear: 2020 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when amount is missing', async () => {
    const { amount: _a, ...body } = validBody;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when cardNumber is too short (12 digits)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, cardNumber: '424242424242' }),
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Success (200) ────────────────────────────────────────────────────────────

describe('POST /v1/checkout/simulate — 200 success', () => {
  it('returns 200 with chargeId, amount, currency on success', async () => {
    mockRunSimulatedCheckout.mockResolvedValue({
      success: true,
      chargeId: 'pi_test123',
      amount: 5000,
      currency: 'eur',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.chargeId).toBe('pi_test123');
    expect(body.amount).toBe(5000);
    expect(body.currency).toBe('eur');
  });

  it('defaults currency to eur when omitted', async () => {
    mockRunSimulatedCheckout.mockResolvedValue({
      success: true,
      chargeId: 'pi_eur',
      amount: 1000,
      currency: 'eur',
    });

    const { currency: _c, ...bodyWithoutCurrency } = validBody;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bodyWithoutCurrency),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.currency).toBe('eur');

    // The service should have been called with currency: 'eur' (schema default)
    expect(mockRunSimulatedCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'eur' }),
    );
  });
});

// ─── Card declined (402) ──────────────────────────────────────────────────────

describe('POST /v1/checkout/simulate — 402 declined', () => {
  it('returns 402 with declineCode when card is declined', async () => {
    mockRunSimulatedCheckout.mockResolvedValue({
      success: false,
      chargeId: '',
      amount: 5000,
      currency: 'eur',
      declineCode: 'insufficient_funds',
      message: 'Your card has insufficient funds.',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.statusCode).toBe(402);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.declineCode).toBe('insufficient_funds');
    expect(body.message).toBe('Your card has insufficient funds.');
  });
});

// ─── Unexpected error (500) ───────────────────────────────────────────────────

describe('POST /v1/checkout/simulate — 500 unexpected error', () => {
  it('returns 500 when the service throws an unexpected error', async () => {
    mockRunSimulatedCheckout.mockRejectedValue(new Error('Stripe connection error'));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout/simulate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.statusCode).toBe(500);
  });
});
