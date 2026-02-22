import { z } from "zod";

export const userRefTelegramSchema = z.object({
  type: z.literal("telegram"),
  telegram_user_id: z.string(),
});

export const userRefInternalSchema = z.object({
  type: z.literal("internal"),
  user_id: z.string().uuid(),
});

export const userRefSchema = z.discriminatedUnion("type", [
  userRefTelegramSchema,
  userRefInternalSchema,
]);

export const constraintsSchema = z.object({
  max_budget: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
  merchant_domain_allowlist: z.array(z.string()).optional(),
});

export const createIntentBodySchema = z.object({
  user_ref: userRefSchema,
  text: z.string().min(1),
  constraints: constraintsSchema,
});

export type CreateIntentBody = z.infer<typeof createIntentBodySchema>;
export type UserRef = z.infer<typeof userRefSchema>;
