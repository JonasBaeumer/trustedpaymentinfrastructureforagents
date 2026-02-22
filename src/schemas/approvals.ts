import { z } from "zod";
import { userRefSchema } from "./intents.js";

export const approvalScopeSchema = z.object({
  merchant_domain: z.string(),
  mcc_allowlist: z.array(z.string()).optional(),
});

export const approvalRequestBodySchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
  scope: approvalScopeSchema,
  expires_in_seconds: z.number().int().positive().default(900),
});

export const approvalDecisionBodySchema = z.object({
  decision: z.enum(["APPROVE", "DENY"]),
  decided_by: userRefSchema,
});

export type ApprovalRequestBody = z.infer<typeof approvalRequestBodySchema>;
export type ApprovalDecisionBody = z.infer<typeof approvalDecisionBodySchema>;
