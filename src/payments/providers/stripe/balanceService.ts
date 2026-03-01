import { IssuingBalance } from '@/contracts';
import { getStripeClient } from './stripeClient';

export async function getIssuingBalance(currency: string): Promise<IssuingBalance> {
  const stripe = getStripeClient();
  const balance = await stripe.balance.retrieve();
  const normalised = currency.toLowerCase();
  const entry = (balance.issuing?.available ?? []).find(
    (b) => b.currency.toLowerCase() === normalised,
  );
  return { available: entry?.amount ?? 0, currency: normalised };
}
