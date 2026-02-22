import { z } from 'zod';

export const checkoutSimulateSchema = z.object({
  intentId: z.string().min(1),
  amount: z.number().int().positive().max(1_000_000),
  currency: z.string().length(3).default('eur'),
  merchantName: z.string().max(200).default('Simulated Merchant'),
});

export type CheckoutSimulateInput = z.infer<typeof checkoutSimulateSchema>;
