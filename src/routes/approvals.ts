import type { FastifyInstance } from "fastify";
import { approvalRequestBodySchema, approvalDecisionBodySchema } from "../schemas/approvals.js";
import { validateApprovalScopeAgainstQuote } from "../services/policy.js";
import * as orchestrator from "../services/orchestrator.js";
import { prisma } from "../lib/db.js";

export default async function approvalsRoutes(app: FastifyInstance) {
  app.post<{ Params: { intentId: string }; Body: unknown }>(
    "/intents/:intentId/approval/request",
    async (req, reply) => {
      const parsed = approvalRequestBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
      const err = await validateApprovalScopeAgainstQuote(req.params.intentId, parsed.data.amount, parsed.data.scope);
      if (err) return reply.status(400).send({ error: err });
      try {
        const { approvalId, status } = await orchestrator.createApprovalRequest(
          req.params.intentId,
          parsed.data
        );
        return reply.status(201).send({ approval_id: approvalId, status });
      } catch (e) {
        if ((e as Error).message === "Intent not found") return reply.status(404).send({ error: "Intent not found" });
        if ((e as Error).message.includes("not in AWAITING_APPROVAL"))
          return reply.status(409).send({ error: (e as Error).message });
        throw e;
      }
    }
  );

  app.post<{ Params: { approvalId: string }; Body: unknown }>(
    "/approvals/:approvalId/decision",
    async (req, reply) => {
      const parsed = approvalDecisionBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
      const { approvalId } = req.params;
      const { decision, decided_by } = parsed.data;

      try {
        const approval = await prisma.approval.findUnique({
          where: { id: approvalId },
          include: { intent: { include: { user: true } } },
        });
        if (!approval) return reply.status(404).send({ error: "Approval not found" });

        const user = approval.intent.user;
        if (decided_by.type === "telegram") {
          if (user.telegramUserId == null) {
            req.log.warn({ approvalId, decided_by, reason: "intent_user_has_no_telegram_id" }, "Approval 401: intent owner has no telegram_user_id");
            return reply.status(401).send({ error: "Intent owner has no Telegram link; cannot approve by telegram" });
          }
          if (user.telegramUserId !== decided_by.telegram_user_id) {
            req.log.warn({ approvalId, decided_by, expected_telegram_id: user.telegramUserId }, "Approval 401: decided_by does not match intent owner");
            return reply.status(401).send({ error: "Only the Telegram user who created the intent can approve or deny" });
          }
        } else {
          if (user.id !== decided_by.user_id) {
            req.log.warn({ approvalId, decided_by, expected_user_id: user.id }, "Approval 401: decided_by user_id does not match intent owner");
            return reply.status(401).send({ error: "Only the user who created the intent can approve or deny" });
          }
        }

        const { intentId, approvalStatus } = await orchestrator.recordApprovalDecision(approvalId, decision, decided_by);
        if (approvalStatus === "APPROVED") {
          const intent = await prisma.purchaseIntent.findUnique({ where: { id: intentId }, select: { status: true } });
          if (intent?.status === "APPROVED") {
            await orchestrator.issueCard(intentId);
            await orchestrator.enqueueCheckout(intentId);
          }
        }
        return reply.send({ intent_id: intentId, approval_status: approvalStatus });
      } catch (e) {
        if ((e as Error).message === "Approval not found")
          return reply.status(404).send({ error: "Approval not found" });
        req.log.error(e, "Approval decision error");
        throw e;
      }
    }
  );
}
