/**
 * Integration test: API key authentication flow
 *
 * Verifies that user-facing routes enforce Bearer token auth,
 * reject invalid keys, and enforce intent ownership.
 *
 * Uses mocked DB (no real Postgres required).
 */

import bcrypt from 'bcryptjs';

const RAW_KEY_USER_A = 'api-key-user-a-for-auth-tests';
const RAW_KEY_USER_B = 'api-key-user-b-for-auth-tests';
let HASH_A: string;
let HASH_B: string;

const USER_A = {
  id: 'user-a',
  email: 'a@agentpay.dev',
  mainBalance: 100000,
  maxBudgetPerIntent: 50000,
  merchantAllowlist: [],
  mccAllowlist: [],
  apiKeyHash: '', // set in beforeAll
  apiKeyPrefix: RAW_KEY_USER_A.slice(0, 16),
  createdAt: new Date(),
};

const USER_B = {
  id: 'user-b',
  email: 'b@agentpay.dev',
  mainBalance: 100000,
  maxBudgetPerIntent: 50000,
  merchantAllowlist: [],
  mccAllowlist: [],
  apiKeyHash: '', // set in beforeAll
  apiKeyPrefix: RAW_KEY_USER_B.slice(0, 16),
  createdAt: new Date(),
};

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

jest.mock('@/queue/producers', () => ({
  enqueueSearch: jest.fn().mockResolvedValue(undefined),
  enqueueCheckout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/payments/stripeClient', () => ({
  getStripeClient: () => ({
    issuing: {
      cardholders: { create: jest.fn().mockResolvedValue({ id: 'ich_test' }) },
      cards: {
        create: jest.fn().mockResolvedValue({ id: 'ic_test', last4: '4242', exp_month: 12, exp_year: 2027 }),
        retrieve: jest.fn().mockResolvedValue({ id: 'ic_test', last4: '4242', exp_month: 12, exp_year: 2027 }),
      },
    },
    webhooks: { constructEvent: jest.fn() },
  }),
}));

// In-memory store
const store: {
  intents: Record<string, any>;
  users: Record<string, any>;
  cards: Record<string, any>;
  auditEvents: any[];
  idempotencyRecords: Record<string, any>;
  approvalDecisions: Record<string, any>;
  pots: Record<string, any>;
  ledgerEntries: any[];
} = {
  intents: {},
  users: {},
  cards: {},
  auditEvents: [],
  idempotencyRecords: {},
  approvalDecisions: {},
  pots: {},
  ledgerEntries: [],
};

jest.mock('@/db/client', () => ({
  prisma: {
    purchaseIntent: {
      create: jest.fn(({ data }: any) => {
        const intent = { id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...data, updatedAt: new Date(), createdAt: new Date() };
        store.intents[intent.id] = intent;
        return Promise.resolve(intent);
      }),
      findUnique: jest.fn(({ where, include }: any) => {
        const intent = store.intents[where.id] ?? null;
        if (!intent) return Promise.resolve(null);
        if (include) {
          return Promise.resolve({
            ...intent,
            auditEvents: store.auditEvents.filter((e) => e.intentId === intent.id),
            virtualCard: store.cards[intent.id] ?? null,
            user: store.users[intent.userId] ?? null,
          });
        }
        return Promise.resolve(intent);
      }),
      update: jest.fn(({ where, data }: any) => {
        store.intents[where.id] = { ...store.intents[where.id], ...data, updatedAt: new Date() };
        return Promise.resolve(store.intents[where.id]);
      }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest.fn(({ where }: any) => {
        if (where.id) return Promise.resolve(store.users[where.id] ?? null);
        if (where.apiKeyPrefix) {
          const found = Object.values(store.users).find((u: any) => u.apiKeyPrefix === where.apiKeyPrefix);
          return Promise.resolve(found ?? null);
        }
        return Promise.resolve(null);
      }),
      update: jest.fn(({ where, data }: any) => {
        store.users[where.id] = { ...store.users[where.id], ...data };
        return Promise.resolve(store.users[where.id]);
      }),
    },
    virtualCard: {
      create: jest.fn(({ data }: any) => {
        const card = { id: `card-${Date.now()}`, ...data, createdAt: new Date() };
        store.cards[data.intentId] = card;
        return Promise.resolve(card);
      }),
      findUnique: jest.fn(({ where }: any) => Promise.resolve(store.cards[where.intentId] ?? null)),
      update: jest.fn(({ where, data }: any) => {
        if (store.cards[where.intentId]) {
          store.cards[where.intentId] = { ...store.cards[where.intentId], ...data };
        }
        return Promise.resolve(store.cards[where.intentId] ?? null);
      }),
    },
    auditEvent: {
      create: jest.fn(({ data }: any) => {
        const e = { id: `ae-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
        store.auditEvents.push(e);
        return Promise.resolve(e);
      }),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(store.auditEvents.filter((e) => e.intentId === where?.intentId)),
      ),
    },
    idempotencyRecord: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(store.idempotencyRecords[where.key] ?? null)),
      upsert: jest.fn(({ where, create }: any) => {
        if (!store.idempotencyRecords[where.key]) store.idempotencyRecords[where.key] = create;
        return Promise.resolve(store.idempotencyRecords[where.key]);
      }),
    },
    approvalDecision: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(store.approvalDecisions[where.intentId] ?? null)),
      upsert: jest.fn(({ where, create }: any) => {
        if (!store.approvalDecisions[where.intentId]) store.approvalDecisions[where.intentId] = create;
        return Promise.resolve(store.approvalDecisions[where.intentId]);
      }),
      create: jest.fn(({ data }: any) => {
        store.approvalDecisions[data.intentId] = { id: `ad-${Date.now()}`, ...data };
        return Promise.resolve(store.approvalDecisions[data.intentId]);
      }),
    },
    pot: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(store.pots[where.intentId] ?? null)),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: any) => {
        const pot = { id: `pot-${Date.now()}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        store.pots[data.intentId] = pot;
        return Promise.resolve(pot);
      }),
      update: jest.fn(({ where, data }: any) => {
        store.pots[where.intentId] = { ...store.pots[where.intentId], ...data };
        return Promise.resolve(store.pots[where.intentId]);
      }),
    },
    ledgerEntry: {
      create: jest.fn(({ data }: any) => {
        const entry = { id: `le-${Date.now()}`, ...data, createdAt: new Date() };
        store.ledgerEntries.push(entry);
        return Promise.resolve(entry);
      }),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(store.ledgerEntries.filter((e) => e.userId === where?.userId)),
      ),
    },
    $transaction: jest.fn(async (fn: Function) => {
      const tx = {
        user: {
          findUnique: jest.fn(({ where }: any) => Promise.resolve(store.users[where.id] ?? null)),
          update: jest.fn(({ where, data }: any) => {
            if (data.mainBalance?.decrement !== undefined) {
              store.users[where.id].mainBalance -= data.mainBalance.decrement;
            } else if (data.mainBalance?.increment !== undefined) {
              store.users[where.id].mainBalance += data.mainBalance.increment;
            } else {
              store.users[where.id] = { ...store.users[where.id], ...data };
            }
            return Promise.resolve(store.users[where.id]);
          }),
        },
        purchaseIntent: {
          findUnique: jest.fn(({ where }: any) => Promise.resolve(store.intents[where.id] ?? null)),
          update: jest.fn(({ where, data }: any) => {
            store.intents[where.id] = { ...store.intents[where.id], ...data };
            return Promise.resolve(store.intents[where.id]);
          }),
        },
        pot: {
          findUnique: jest.fn(({ where }: any) => Promise.resolve(store.pots[where.intentId] ?? null)),
          create: jest.fn(({ data }: any) => {
            const pot = { id: `pot-${Date.now()}`, ...data, createdAt: new Date(), updatedAt: new Date() };
            store.pots[data.intentId] = pot;
            return Promise.resolve(pot);
          }),
          update: jest.fn(({ where, data }: any) => {
            store.pots[where.intentId] = { ...store.pots[where.intentId], ...data };
            return Promise.resolve(store.pots[where.intentId]);
          }),
        },
        ledgerEntry: {
          create: jest.fn(({ data }: any) => {
            const entry = { id: `le-${Date.now()}`, ...data, createdAt: new Date() };
            store.ledgerEntries.push(entry);
            return Promise.resolve(entry);
          }),
        },
        auditEvent: {
          create: jest.fn(({ data }: any) => {
            const e = { id: `ae-${Date.now()}`, ...data, createdAt: new Date() };
            store.auditEvents.push(e);
            return Promise.resolve(e);
          }),
        },
      };
      return fn(tx);
    }),
  },
}));

import { buildApp } from '@/app';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let authHeaderA: string;
let authHeaderB: string;

beforeAll(async () => {
  HASH_A = await bcrypt.hash(RAW_KEY_USER_A, 10);
  HASH_B = await bcrypt.hash(RAW_KEY_USER_B, 10);
  USER_A.apiKeyHash = HASH_A;
  USER_B.apiKeyHash = HASH_B;
  store.users[USER_A.id] = USER_A;
  store.users[USER_B.id] = USER_B;
  authHeaderA = `Bearer ${RAW_KEY_USER_A}`;
  authHeaderB = `Bearer ${RAW_KEY_USER_B}`;

  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ─── 1. Unauthenticated access ──────────────────────────────────────────────

describe('Unauthenticated access is rejected', () => {
  it('POST /v1/intents without Authorization header -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { 'content-type': 'application/json', 'x-idempotency-key': 'noauth-1' },
      body: JSON.stringify({ query: 'test item', maxBudget: 1000 }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /v1/users/me with no key -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/users/me' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /v1/approvals/:id/decision without auth -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/approvals/any-intent/decision',
      headers: { 'content-type': 'application/json', 'x-idempotency-key': 'noauth-2' },
      body: JSON.stringify({ decision: 'APPROVED', actorId: 'x' }),
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── 2. Wrong API key ───────────────────────────────────────────────────────

describe('Wrong API key is rejected', () => {
  it('POST /v1/intents with wrong key -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'wrongkey-1',
        authorization: 'Bearer totally-wrong-key',
      },
      body: JSON.stringify({ query: 'test item', maxBudget: 1000 }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /v1/users/me with wrong key -> 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: 'Bearer totally-wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── 3. Valid key: intent creation and retrieval ────────────────────────────

describe('Authenticated intent creation', () => {
  let intentId: string;

  it('POST /v1/intents with valid key -> 201, intent created for authenticated user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'auth-intent-1',
        authorization: authHeaderA,
      },
      body: JSON.stringify({ query: 'Sony WH-1000XM5', maxBudget: 30000, currency: 'eur' }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.intentId).toBeDefined();
    expect(body.status).toBe('SEARCHING');
    intentId = body.intentId;

    // Verify the intent in the store belongs to user A
    expect(store.intents[intentId].userId).toBe(USER_A.id);
  });

  it('GET /v1/intents/:id with valid key for own intent -> 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/intents/${intentId}`,
      headers: { authorization: authHeaderA },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).intent.id).toBe(intentId);
  });

  it('GET /v1/intents/:id with valid key for another user\'s intent -> 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/intents/${intentId}`,
      headers: { authorization: authHeaderB },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── 4. GET /v1/users/me ────────────────────────────────────────────────────

describe('GET /v1/users/me', () => {
  it('returns correct user profile with valid key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: authHeaderA },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(USER_A.id);
    expect(body.email).toBe(USER_A.email);
    expect(body.mainBalance).toBe(USER_A.mainBalance);
  });
});

// ─── 5. Approval ownership enforcement ──────────────────────────────────────

describe('Approval ownership enforcement', () => {
  let intentId: string;

  beforeAll(async () => {
    // Create an intent owned by user A in AWAITING_APPROVAL state
    const res = await app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'auth-approval-setup',
        authorization: authHeaderA,
      },
      body: JSON.stringify({ query: 'test approval ownership', maxBudget: 5000, currency: 'eur' }),
    });
    intentId = JSON.parse(res.body).intentId;
    // Manually move to AWAITING_APPROVAL
    store.intents[intentId].status = 'AWAITING_APPROVAL';
  });

  it('POST /v1/approvals/:id/decision for another user\'s intent -> 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${intentId}/decision`,
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'auth-approval-403',
        authorization: authHeaderB,
      },
      body: JSON.stringify({ decision: 'APPROVED', actorId: USER_B.id }),
    });
    expect(res.statusCode).toBe(403);
  });
});
