import { z } from "zod";

export const quotePayloadSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  amount: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
  merchant_domain: z.string(),
  mcc_hint: z.string().optional(),
});

export const agentQuoteBodySchema = z.object({
  intent_id: z.string().uuid(),
  quote: quotePayloadSchema,
});

export type AgentQuoteBody = z.infer<typeof agentQuoteBodySchema>;
export type QuotePayload = z.infer<typeof quotePayloadSchema>;
