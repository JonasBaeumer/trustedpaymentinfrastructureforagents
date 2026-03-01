/**
 * Test-only helpers for the payments module.
 * Import these only in test files — never in production code.
 */
import { MockPaymentProvider } from './providers/mock/mockProvider';
import { getPaymentProvider, resetPaymentProvider } from './providerFactory';

export { resetPaymentProvider };

export function getMockProvider(): MockPaymentProvider {
  const provider = getPaymentProvider();
  if (!(provider instanceof MockPaymentProvider)) {
    throw new Error('getMockProvider() called but active provider is not MockPaymentProvider');
  }
  return provider;
}

export function getMockProviderCalls() {
  return getMockProvider().getCalls();
}

export function clearMockProviderCalls() {
  getMockProvider().clearCalls();
}
