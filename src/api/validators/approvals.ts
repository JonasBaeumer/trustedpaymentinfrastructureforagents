import { z } from 'zod';

export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'DENIED']),
  actorId: z.string().min(1),
  reason: z.string().optional(),
});

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
