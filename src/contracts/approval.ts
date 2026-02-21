import { ApprovalDecisionType as PrismaApprovalDecisionType } from '@prisma/client';

export { PrismaApprovalDecisionType as ApprovalDecisionType };

export interface ApprovalDecisionData {
  id: string;
  intentId: string;
  decision: PrismaApprovalDecisionType;
  actorId: string;
  reason: string | null;
  createdAt: Date;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}
