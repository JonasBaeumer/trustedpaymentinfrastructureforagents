import Stripe from 'stripe';

const PLACEHOLDER = 'sk_test_placeholder';

export async function validateStripeSetup(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key || key === PLACEHOLDER) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'STRIPE_SECRET_KEY is not configured — Stripe features will not work',
    }));
    return;
  }

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' as Stripe.LatestApiVersion });

  try {
    await stripe.issuing.cards.list({ limit: 1 });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeAuthenticationError) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'STRIPE_SECRET_KEY is invalid — Stripe authentication failed',
      }));
      return;
    }
    if (err instanceof Stripe.errors.StripePermissionError ||
        (err instanceof Stripe.errors.StripeError && err.code === 'resource_missing')) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Stripe Issuing is not enabled on this account. Apply at https://stripe.com/issuing',
      }));
      return;
    }
    console.warn(JSON.stringify({
      level: 'warn',
      message: `Stripe validation failed: ${err instanceof Error ? err.message : String(err)}`,
    }));
    return;
  }

  const mode = key.startsWith('sk_live_') ? 'live' : 'test';
  console.log(JSON.stringify({
    level: 'info',
    message: `Stripe Issuing is enabled (mode: ${mode})`,
  }));

  try {
    const balance = await stripe.balance.retrieve();
    const issuingBalance = balance.issuing?.available ?? [];
    const summary = issuingBalance.map(b => `${b.amount} ${b.currency}`).join(', ') || 'no funds';
    console.log(JSON.stringify({
      level: 'info',
      message: `Stripe Issuing balance: ${summary}`,
    }));
  } catch {
    // Balance retrieval is informational — don't fail
  }
}
