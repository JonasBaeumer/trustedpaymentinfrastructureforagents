import { IPaymentProvider } from '@/contracts';

let _provider: IPaymentProvider | null = null;

export function getPaymentProvider(): IPaymentProvider {
  if (_provider) return _provider;

  const name = process.env.PAYMENT_PROVIDER ?? 'stripe';

  if (name === 'mock' || process.env.NODE_ENV === 'test') {
    const { MockPaymentProvider } = require('./providers/mock/mockProvider');
    _provider = new MockPaymentProvider();
  } else {
    const { StripePaymentProvider } = require('./providers/stripe');
    _provider = new StripePaymentProvider();
  }

  return _provider;
}

export function resetPaymentProvider(): void {
  _provider = null;
}
