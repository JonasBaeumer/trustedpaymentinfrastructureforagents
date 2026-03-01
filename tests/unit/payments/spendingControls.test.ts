import { buildSpendingControls } from '@/payments/providers/stripe/spendingControls';

describe('buildSpendingControls', () => {
  it('creates per-authorization limit', () => {
    const controls = buildSpendingControls(10000);
    expect(controls.spending_limits).toHaveLength(1);
    expect(controls.spending_limits![0]).toEqual({ amount: 10000, interval: 'per_authorization' });
  });

  it('does not include allowed_categories when no mccAllowlist', () => {
    const controls = buildSpendingControls(10000);
    expect(controls.allowed_categories).toBeUndefined();
  });

  it('does not include allowed_categories for empty mccAllowlist', () => {
    const controls = buildSpendingControls(10000, []);
    expect(controls.allowed_categories).toBeUndefined();
  });

  it('includes allowed_categories when mccAllowlist provided', () => {
    const controls = buildSpendingControls(10000, ['general_merchandise', 'electronics_stores']);
    expect(controls.allowed_categories).toEqual(['general_merchandise', 'electronics_stores']);
  });

  it('handles large amounts correctly', () => {
    const controls = buildSpendingControls(50000);
    expect(controls.spending_limits![0].amount).toBe(50000);
  });
});
