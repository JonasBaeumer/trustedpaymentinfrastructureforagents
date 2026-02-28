import { z } from 'zod';

export const createIntentSchema = z.object({
  query: z.string().min(1).max(500),
  subject: z.string().min(1).max(100).optional(),
  maxBudget: z.number().int().positive().max(1000000), // max €10,000 in cents
  currency: z.string().length(3).default('eur'),
  expiresAt: z.string().datetime().optional(),
});

export type CreateIntentInput = z.infer<typeof createIntentSchema>;
