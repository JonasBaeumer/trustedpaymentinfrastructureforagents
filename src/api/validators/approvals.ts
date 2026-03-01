import { z } from 'zod';

export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'DENIED']),
  reason: z.string().optional(),
});

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
