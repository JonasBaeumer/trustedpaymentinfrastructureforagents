import Stripe from 'stripe';
import { getStripeClient } from './stripeClient';

export interface SimulatedCheckoutResult {
  success: boolean;
  chargeId: string;
  amount: number;
  currency: string;
  declineCode?: string;
  message?: string;
}

export async function runSimulatedCheckout(params: {
  cardNumber: string;
  cvc: string;
  expMonth: number;
  expYear: number;
  amount: number;
  currency: string;
  merchantName: string;
}): Promise<SimulatedCheckoutResult> {
  const stripe = getStripeClient();
  const { cardNumber, cvc, expMonth, expYear, amount, currency, merchantName } = params;

  let paymentMethod: Stripe.PaymentMethod;
  try {
    paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: cardNumber,
        exp_month: expMonth,
        exp_year: expYear,
        cvc,
      },
    });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      return {
        success: false,
        chargeId: '',
        amount,
        currency,
        declineCode: err.decline_code ?? err.code ?? 'card_declined',
        message: err.message,
      };
    }
    if (err instanceof Stripe.errors.StripeError) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'checkoutSimulator: paymentMethod create failed',
        type: err.type,
        code: err.code,
        errMessage: err.message,
      }));
    }
    throw err;
  }

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: currency.toLowerCase(),
      payment_method: paymentMethod.id,
      confirm: true,
      error_on_requires_action: true,
      return_url: 'https://example.com/return',
      description: merchantName,
    });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      return {
        success: false,
        chargeId: '',
        amount,
        currency,
        declineCode: err.decline_code ?? err.code ?? 'card_declined',
        message: err.message,
      };
    }
    if (err instanceof Stripe.errors.StripeError) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'checkoutSimulator: paymentIntent create failed',
        type: err.type,
        code: err.code,
        errMessage: err.message,
      }));
    }
    throw err;
  }

  return {
    success: true,
    chargeId: paymentIntent.id,
    amount,
    currency,
  };
}
