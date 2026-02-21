export interface SearchIntentJob {
  intentId: string;
  userId: string;
  query: string;
  maxBudget: number;
  currency: string;
}

export interface CheckoutIntentJob {
  intentId: string;
  userId: string;
  merchantName: string;
  merchantUrl: string;
  price: number;
  currency: string;
  stripeCardId: string;
  last4: string;
}
