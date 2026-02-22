import { z } from 'zod';

export const checkoutSimulateSchema = z.object({
  cardNumber: z.string().regex(/^\d{13,19}$/, 'Must be 13–19 digits'),
  cvc: z.string().regex(/^\d{3,4}$/, 'Must be 3–4 digits'),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(new Date().getFullYear()),
  amount: z.number().int().positive().max(1_000_000),
  currency: z.string().length(3).default('eur'),
  merchantName: z.string().max(200).default('Simulated Merchant'),
});

export type CheckoutSimulateInput = z.infer<typeof checkoutSimulateSchema>;
