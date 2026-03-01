import {
  MockPaymentProvider,
  getMockProviderCalls,
  clearMockProviderCalls,
} from '@/payments/providers/mock/mockProvider';
import { VirtualCardData, CardReveal } from '@/contracts';

describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    clearMockProviderCalls();
    provider = new MockPaymentProvider();
  });

  describe('issueCard', () => {
    it('returns a VirtualCardData with mock values', async () => {
      const result = await provider.issueCard('intent-1', 5000, 'eur');

      expect(result).toMatchObject({
        id: 'mock-card-intent-1',
        intentId: 'intent-1',
        stripeCardId: 'mock_stripe_intent-1',
        last4: '4242',
        revealedAt: null,
        frozenAt: null,
        cancelledAt: null,
      });
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('passes options through to call recording', async () => {
      await provider.issueCard('intent-2', 10000, 'gbp', { mccAllowlist: ['5411'] });

      const calls = getMockProviderCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('issueCard');
      expect(calls[0].args).toEqual(['intent-2', 10000, 'gbp', { mccAllowlist: ['5411'] }]);
    });
  });

  describe('revealCard', () => {
    it('returns a CardReveal with test card details', async () => {
      const result = await provider.revealCard('intent-1');

      expect(result).toEqual({
        number: '4242424242424242',
        cvc: '123',
        expMonth: 12,
        expYear: 2030,
        last4: '4242',
      });
    });

    it('records the call', async () => {
      await provider.revealCard('intent-3');

      const calls = getMockProviderCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('revealCard');
      expect(calls[0].args).toEqual(['intent-3']);
    });
  });

  describe('freezeCard', () => {
    it('resolves without error', async () => {
      await expect(provider.freezeCard('intent-1')).resolves.toBeUndefined();
    });

    it('records the call', async () => {
      await provider.freezeCard('intent-4');

      const calls = getMockProviderCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('freezeCard');
      expect(calls[0].args).toEqual(['intent-4']);
    });
  });

  describe('cancelCard', () => {
    it('resolves without error', async () => {
      await expect(provider.cancelCard('intent-1')).resolves.toBeUndefined();
    });

    it('records the call', async () => {
      await provider.cancelCard('intent-5');

      const calls = getMockProviderCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('cancelCard');
      expect(calls[0].args).toEqual(['intent-5']);
    });
  });

  describe('handleWebhookEvent', () => {
    it('resolves without error', async () => {
      await expect(provider.handleWebhookEvent(Buffer.from('{}'), 'sig')).resolves.toBeUndefined();
    });

    it('records the call with raw body and signature', async () => {
      const body = Buffer.from('{"type":"test"}');
      await provider.handleWebhookEvent(body, 'whsec_test');

      const calls = getMockProviderCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('handleWebhookEvent');
      expect(calls[0].args).toEqual([body, 'whsec_test']);
    });
  });

  describe('call recording', () => {
    it('records calls across multiple methods in order', async () => {
      await provider.issueCard('i1', 1000, 'eur');
      await provider.revealCard('i1');
      await provider.cancelCard('i1');

      const calls = getMockProviderCalls();
      expect(calls).toHaveLength(3);
      expect(calls.map((c) => c.method)).toEqual(['issueCard', 'revealCard', 'cancelCard']);
    });

    it('includes timestamps on each call', async () => {
      const before = Date.now();
      await provider.issueCard('i1', 1000, 'eur');
      const after = Date.now();

      const calls = getMockProviderCalls();
      expect(calls[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(calls[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('returns a copy — mutations do not affect internal state', async () => {
      await provider.issueCard('i1', 1000, 'eur');

      const calls = getMockProviderCalls();
      calls.length = 0;

      expect(getMockProviderCalls()).toHaveLength(1);
    });
  });

  describe('clearMockProviderCalls', () => {
    it('removes all recorded calls', async () => {
      await provider.issueCard('i1', 1000, 'eur');
      await provider.revealCard('i1');
      expect(getMockProviderCalls()).toHaveLength(2);

      clearMockProviderCalls();
      expect(getMockProviderCalls()).toHaveLength(0);
    });
  });
});
