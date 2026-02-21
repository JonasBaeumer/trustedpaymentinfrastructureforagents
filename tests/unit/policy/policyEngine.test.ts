jest.mock('@/db/client', () => ({
  prisma: {
    purchaseIntent: { count: jest.fn() },
    auditEvent: { create: jest.fn() },
  },
}));

import { evaluateIntent } from '@/policy/policyEngine';
import { prisma } from '@/db/client';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const baseIntent = {
  id: 'intent-1',
  userId: 'user-1',
  maxBudget: 10000,
  metadata: { merchantUrl: 'https://amazon.co.uk', merchantName: 'Amazon UK' },
  createdAt: new Date(),
};

const baseUser = {
  id: 'user-1',
  maxBudgetPerIntent: 50000,
  merchantAllowlist: [] as string[],
  mccAllowlist: [] as string[],
};

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.purchaseIntent.count as jest.Mock).mockResolvedValue(0);
  (mockPrisma.auditEvent.create as jest.Mock).mockResolvedValue({});
});

describe('evaluateIntent — budget rule', () => {
  it('allows intent within budget', async () => {
    const result = await evaluateIntent(baseIntent, baseUser);
    expect(result.allowed).toBe(true);
  });

  it('denies intent exceeding budget', async () => {
    const result = await evaluateIntent({ ...baseIntent, maxBudget: 100000 }, baseUser);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeds user max');
  });
});

describe('evaluateIntent — merchant allowlist', () => {
  it('allows when allowlist is empty', async () => {
    const result = await evaluateIntent(baseIntent, baseUser);
    expect(result.allowed).toBe(true);
  });

  it('allows when merchant is in allowlist', async () => {
    const user = { ...baseUser, merchantAllowlist: ['amazon.co.uk'] };
    const result = await evaluateIntent(baseIntent, user);
    expect(result.allowed).toBe(true);
  });

  it('denies when merchant is not in allowlist', async () => {
    const user = { ...baseUser, merchantAllowlist: ['ebay.co.uk'] };
    const result = await evaluateIntent(baseIntent, user);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in allowlist');
  });
});

describe('evaluateIntent — rate limit', () => {
  it('allows when under rate limit', async () => {
    (mockPrisma.purchaseIntent.count as jest.Mock).mockResolvedValue(2);
    const result = await evaluateIntent(baseIntent, baseUser);
    expect(result.allowed).toBe(true);
  });

  it('denies when rate limit exceeded', async () => {
    (mockPrisma.purchaseIntent.count as jest.Mock).mockResolvedValue(3);
    const result = await evaluateIntent(baseIntent, baseUser);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Rate limit');
  });
});
