// Mock stripe
const mockStripe = {
  issuing: {
    cardholders: { create: jest.fn() },
    cards: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn() },
    authorizations: { approve: jest.fn() },
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
};
jest.mock('@/payments/stripeClient', () => ({ getStripeClient: () => mockStripe }));

// Mock prisma
jest.mock('@/db/client', () => ({
  prisma: {
    purchaseIntent: { findUnique: jest.fn() },
    virtualCard: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    auditEvent: { create: jest.fn() },
  },
}));

import { issueVirtualCard, revealCard, freezeCard, cancelCard } from '@/payments/cardService';
import { prisma } from '@/db/client';
import { CardAlreadyRevealedError, IntentNotFoundError } from '@/contracts';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('issueVirtualCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates cardholder and card with correct spending controls', async () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };
    const mockIntent = { id: 'intent-1', user: mockUser, currency: 'gbp' };
    (mockPrisma.purchaseIntent.findUnique as jest.Mock).mockResolvedValue(mockIntent);
    mockStripe.issuing.cardholders.create.mockResolvedValue({ id: 'ich_123' });
    mockStripe.issuing.cards.create.mockResolvedValue({ id: 'ic_123', last4: '4242' });
    (mockPrisma.virtualCard.create as jest.Mock).mockResolvedValue({
      id: 'vc-1', intentId: 'intent-1', stripeCardId: 'ic_123', last4: '4242',
    });

    const result = await issueVirtualCard('intent-1', 10000, 'gbp');

    expect(mockStripe.issuing.cards.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'virtual',
        currency: 'gbp',
        spending_controls: expect.objectContaining({
          spending_limits: [{ amount: 10000, interval: 'per_authorization' }],
        }),
      }),
      expect.objectContaining({ idempotencyKey: 'intent-1' }),
    );
    expect(result.last4).toBe('4242');
  });

  it('uses intentId as idempotency key', async () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };
    (mockPrisma.purchaseIntent.findUnique as jest.Mock).mockResolvedValue({ id: 'intent-99', user: mockUser });
    mockStripe.issuing.cardholders.create.mockResolvedValue({ id: 'ich_123' });
    mockStripe.issuing.cards.create.mockResolvedValue({ id: 'ic_123', last4: '1234' });
    (mockPrisma.virtualCard.create as jest.Mock).mockResolvedValue({
      id: 'vc-1', intentId: 'intent-99', stripeCardId: 'ic_123', last4: '1234',
    });

    await issueVirtualCard('intent-99', 5000, 'gbp');

    expect(mockStripe.issuing.cards.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: 'intent-99' }),
    );
  });

  it('does not store PAN or CVC in DB', async () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };
    (mockPrisma.purchaseIntent.findUnique as jest.Mock).mockResolvedValue({ id: 'intent-1', user: mockUser });
    mockStripe.issuing.cardholders.create.mockResolvedValue({ id: 'ich_123' });
    mockStripe.issuing.cards.create.mockResolvedValue({
      id: 'ic_123', last4: '1234', number: '4242424242424242', cvc: '123',
    });
    (mockPrisma.virtualCard.create as jest.Mock).mockResolvedValue({
      id: 'vc-1', stripeCardId: 'ic_123', last4: '1234',
    });

    await issueVirtualCard('intent-1', 10000, 'gbp');

    // DB create should NOT include number or cvc
    const createCall = (mockPrisma.virtualCard.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data).not.toHaveProperty('number');
    expect(createCall.data).not.toHaveProperty('cvc');
  });

  it('throws IntentNotFoundError for missing intent', async () => {
    (mockPrisma.purchaseIntent.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(issueVirtualCard('missing-intent', 10000, 'gbp')).rejects.toThrow(IntentNotFoundError);
  });

  it('passes MCC allowlist to spending controls', async () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };
    (mockPrisma.purchaseIntent.findUnique as jest.Mock).mockResolvedValue({ id: 'intent-1', user: mockUser });
    mockStripe.issuing.cardholders.create.mockResolvedValue({ id: 'ich_123' });
    mockStripe.issuing.cards.create.mockResolvedValue({ id: 'ic_123', last4: '4242' });
    (mockPrisma.virtualCard.create as jest.Mock).mockResolvedValue({
      id: 'vc-1', intentId: 'intent-1', stripeCardId: 'ic_123', last4: '4242',
    });

    await issueVirtualCard('intent-1', 10000, 'gbp', { mccAllowlist: ['general_merchandise'] });

    expect(mockStripe.issuing.cards.create).toHaveBeenCalledWith(
      expect.objectContaining({
        spending_controls: expect.objectContaining({
          allowed_categories: ['general_merchandise'],
        }),
      }),
      expect.anything(),
    );
  });
});

describe('revealCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws CardAlreadyRevealedError on second call', async () => {
    const mockCard = { intentId: 'intent-1', stripeCardId: 'ic_123', last4: '4242', revealedAt: new Date() };
    (mockPrisma.virtualCard.findUnique as jest.Mock).mockResolvedValue(mockCard);

    await expect(revealCard('intent-1')).rejects.toThrow(CardAlreadyRevealedError);
  });

  it('sets revealedAt on first call', async () => {
    const mockCard = { intentId: 'intent-1', stripeCardId: 'ic_123', last4: '4242', revealedAt: null };
    (mockPrisma.virtualCard.findUnique as jest.Mock).mockResolvedValue(mockCard);
    mockStripe.issuing.cards.retrieve.mockResolvedValue({
      id: 'ic_123', last4: '4242', exp_month: 12, exp_year: 2027, number: '4242424242424242', cvc: '123',
    });
    (mockPrisma.virtualCard.update as jest.Mock).mockResolvedValue({});

    const result = await revealCard('intent-1');

    expect(mockPrisma.virtualCard.update).toHaveBeenCalledWith({
      where: { intentId: 'intent-1' },
      data: expect.objectContaining({ revealedAt: expect.any(Date) }),
    });
    expect(result.number).toBe('4242424242424242');
    expect(result.cvc).toBe('123');
    expect(result.expMonth).toBe(12);
    expect(result.expYear).toBe(2027);
    expect(result.last4).toBe('4242');
  });

  it('throws IntentNotFoundError for missing card', async () => {
    (mockPrisma.virtualCard.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(revealCard('missing-intent')).rejects.toThrow(IntentNotFoundError);
  });

  it('expands number and cvc when retrieving from Stripe', async () => {
    const mockCard = { intentId: 'intent-1', stripeCardId: 'ic_456', last4: '9999', revealedAt: null };
    (mockPrisma.virtualCard.findUnique as jest.Mock).mockResolvedValue(mockCard);
    mockStripe.issuing.cards.retrieve.mockResolvedValue({
      id: 'ic_456', last4: '9999', exp_month: 6, exp_year: 2028, number: '5555555555554444', cvc: '456',
    });
    (mockPrisma.virtualCard.update as jest.Mock).mockResolvedValue({});

    await revealCard('intent-1');

    expect(mockStripe.issuing.cards.retrieve).toHaveBeenCalledWith('ic_456', {
      expand: ['number', 'cvc'],
    });
  });
});

describe('freezeCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls Stripe with inactive status and updates DB', async () => {
    const mockCard = { intentId: 'intent-1', stripeCardId: 'ic_123', last4: '4242' };
    (mockPrisma.virtualCard.findUnique as jest.Mock).mockResolvedValue(mockCard);
    mockStripe.issuing.cards.update.mockResolvedValue({});
    (mockPrisma.virtualCard.update as jest.Mock).mockResolvedValue({});

    await freezeCard('intent-1');

    expect(mockStripe.issuing.cards.update).toHaveBeenCalledWith('ic_123', { status: 'inactive' });
    expect(mockPrisma.virtualCard.update).toHaveBeenCalledWith({
      where: { intentId: 'intent-1' },
      data: expect.objectContaining({ frozenAt: expect.any(Date) }),
    });
  });

  it('throws IntentNotFoundError for missing card', async () => {
    (mockPrisma.virtualCard.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(freezeCard('missing')).rejects.toThrow(IntentNotFoundError);
  });
});

describe('cancelCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls Stripe with canceled status and updates DB', async () => {
    const mockCard = { intentId: 'intent-1', stripeCardId: 'ic_123', last4: '4242' };
    (mockPrisma.virtualCard.findUnique as jest.Mock).mockResolvedValue(mockCard);
    mockStripe.issuing.cards.update.mockResolvedValue({});
    (mockPrisma.virtualCard.update as jest.Mock).mockResolvedValue({});

    await cancelCard('intent-1');

    expect(mockStripe.issuing.cards.update).toHaveBeenCalledWith('ic_123', { status: 'canceled' });
    expect(mockPrisma.virtualCard.update).toHaveBeenCalledWith({
      where: { intentId: 'intent-1' },
      data: expect.objectContaining({ cancelledAt: expect.any(Date) }),
    });
  });

  it('throws IntentNotFoundError for missing card', async () => {
    (mockPrisma.virtualCard.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(cancelCard('missing')).rejects.toThrow(IntentNotFoundError);
  });
});

describe('webhookHandler', () => {
  it('rejects invalid signature', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const { handleStripeEvent } = require('@/payments/webhookHandler');
    await expect(handleStripeEvent(Buffer.from('{}'), 'bad-sig')).rejects.toThrow('Webhook signature verification failed');
  });
});
