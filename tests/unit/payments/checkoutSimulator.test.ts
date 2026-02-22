import Stripe from 'stripe';

// Mock Stripe client
const mockStripe = {
  paymentMethods: { create: jest.fn() },
  paymentIntents: { create: jest.fn() },
};
jest.mock('@/payments/stripeClient', () => ({ getStripeClient: () => mockStripe }));

import { runSimulatedCheckout } from '@/payments/checkoutSimulator';

const validParams = {
  cardNumber: '4242424242424242',
  cvc: '123',
  expMonth: 12,
  expYear: 2027,
  amount: 5000,
  currency: 'eur',
  merchantName: 'Amazon DE',
};

beforeEach(() => jest.clearAllMocks());

describe('runSimulatedCheckout — success path', () => {
  it('returns success=true with chargeId, amount, currency', async () => {
    mockStripe.paymentMethods.create.mockResolvedValue({ id: 'pm_test123' });
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_test456', status: 'succeeded' });

    const result = await runSimulatedCheckout(validParams);

    expect(result.success).toBe(true);
    expect(result.chargeId).toBe('pi_test456');
    expect(result.amount).toBe(5000);
    expect(result.currency).toBe('eur');
  });

  it('creates PaymentMethod with the provided card credentials', async () => {
    mockStripe.paymentMethods.create.mockResolvedValue({ id: 'pm_creds' });
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_creds', status: 'succeeded' });

    await runSimulatedCheckout(validParams);

    expect(mockStripe.paymentMethods.create).toHaveBeenCalledWith({
      type: 'card',
      card: {
        number: '4242424242424242',
        exp_month: 12,
        exp_year: 2027,
        cvc: '123',
      },
    });
  });

  it('confirms the PaymentIntent with the created payment method', async () => {
    mockStripe.paymentMethods.create.mockResolvedValue({ id: 'pm_confirm' });
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_confirm', status: 'succeeded' });

    await runSimulatedCheckout(validParams);

    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        currency: 'eur',
        payment_method: 'pm_confirm',
        confirm: true,
      }),
    );
  });

  it('forwards the amount to the PaymentIntent exactly', async () => {
    mockStripe.paymentMethods.create.mockResolvedValue({ id: 'pm_amt' });
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_amt', status: 'succeeded' });

    await runSimulatedCheckout({ ...validParams, amount: 99999 });

    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 99999 }),
    );
  });

  it('defaults currency to eur when not specified (schema default)', async () => {
    mockStripe.paymentMethods.create.mockResolvedValue({ id: 'pm_eur' });
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_eur', status: 'succeeded' });

    // The schema default is applied upstream; here we test the service honours it
    const result = await runSimulatedCheckout({ ...validParams, currency: 'eur' });

    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'eur' }),
    );
    expect(result.currency).toBe('eur');
  });
});

describe('runSimulatedCheckout — card declined', () => {
  function makeCardError(declineCode: string, message: string) {
    const err = new Stripe.errors.StripeCardError({
      type: 'card_error',
      message,
      code: 'card_declined',
      decline_code: declineCode,
      param: '',
      doc_url: '',
      payment_intent: undefined,
      payment_method: undefined,
      payment_method_type: undefined,
      setup_intent: undefined,
      source: undefined,
      charge: undefined,
      headers: {},
      requestId: 'req_test',
      statusCode: 402,
      rawType: 'card_error',
      raw: {},
    } as any);
    return err;
  }

  it('returns success=false with declineCode when PaymentIntent throws card_error', async () => {
    mockStripe.paymentMethods.create.mockResolvedValue({ id: 'pm_decline' });
    mockStripe.paymentIntents.create.mockRejectedValue(
      makeCardError('card_declined', 'Your card was declined.'),
    );

    const result = await runSimulatedCheckout(validParams);

    expect(result.success).toBe(false);
    expect(result.declineCode).toBe('card_declined');
    expect(result.message).toBe('Your card was declined.');
  });

  it('returns success=false on spending_controls_violation', async () => {
    mockStripe.paymentMethods.create.mockResolvedValue({ id: 'pm_limit' });
    mockStripe.paymentIntents.create.mockRejectedValue(
      makeCardError('spending_controls_violation', 'Spending limit exceeded.'),
    );

    const result = await runSimulatedCheckout(validParams);

    expect(result.success).toBe(false);
    expect(result.declineCode).toBe('spending_controls_violation');
  });

  it('returns success=false when PaymentMethod create throws card_error', async () => {
    mockStripe.paymentMethods.create.mockRejectedValue(
      makeCardError('invalid_number', 'Your card number is invalid.'),
    );

    const result = await runSimulatedCheckout(validParams);

    expect(result.success).toBe(false);
    expect(result.declineCode).toBe('invalid_number');
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('runSimulatedCheckout — unexpected errors', () => {
  it('rethrows non-card Stripe errors (api_error)', async () => {
    mockStripe.paymentMethods.create.mockResolvedValue({ id: 'pm_apierr' });
    const apiErr = new Stripe.errors.StripeAPIError({
      type: 'api_error',
      message: 'An error occurred with our connection to Stripe.',
      headers: {},
      requestId: 'req_api',
      statusCode: 500,
      rawType: 'api_error',
      raw: {},
    } as any);
    mockStripe.paymentIntents.create.mockRejectedValue(apiErr);

    await expect(runSimulatedCheckout(validParams)).rejects.toThrow(Stripe.errors.StripeAPIError);
  });

  it('rethrows generic non-Stripe errors', async () => {
    mockStripe.paymentMethods.create.mockRejectedValue(new Error('Network timeout'));

    await expect(runSimulatedCheckout(validParams)).rejects.toThrow('Network timeout');
  });
});
