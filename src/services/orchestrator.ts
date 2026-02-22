import { prisma } from "../lib/db.js";
import type { IntentStatus } from "@prisma/client";
import { resolveUserRef } from "./user-resolver.js";
import type { UserRef } from "../schemas/intents.js";
import type { QuotePayload } from "../schemas/quotes.js";
import type { ApprovalRequestBody } from "../schemas/approvals.js";
import { getOrCreatePurchasePot } from "./ledger.js";
import * as payments from "./payments.js";
import { checkoutQueue } from "../lib/queue.js";
import type { CreateIntentBody } from "../schemas/intents.js";

const VALID_TRANSITIONS: Record<IntentStatus, IntentStatus[]> = {
  RECEIVED: ["SEARCHING", "QUOTED", "FAILED", "EXPIRED", "DENIED"],
  SEARCHING: ["QUOTED", "FAILED", "EXPIRED"],
  QUOTED: ["AWAITING_APPROVAL", "FAILED", "EXPIRED"],
  AWAITING_APPROVAL: ["APPROVED", "DENIED", "EXPIRED", "FAILED"],
  APPROVED: ["CARD_ISSUED", "FAILED"],
  CARD_ISSUED: ["CHECKOUT_RUNNING", "FAILED"],
  CHECKOUT_RUNNING: ["DONE", "FAILED"],
  DONE: [],
  FAILED: [],
  DENIED: [],
  EXPIRED: [],
};

function assertTransition(from: IntentStatus, to: IntentStatus): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed?.includes(to)) throw new Error(`Invalid transition: ${from} -> ${to}`);
}

async function emitEvent(intentId: string, type: string, payload: object): Promise<void> {
  await prisma.event.create({
    data: {
      intentId,
      type,
      payloadJson: JSON.stringify(payload),
    },
  });
}

export async function createIntent(body: CreateIntentBody): Promise<{ intentId: string; status: IntentStatus }> {
  const userId = await resolveUserRef(body.user_ref);
  const intent = await prisma.purchaseIntent.create({
    data: {
      userId,
      rawText: body.text,
      status: "RECEIVED",
      currency: body.constraints.currency ?? "USD",
    },
  });
  await emitEvent(intent.id, "INTENT_CREATED", {
    user_ref: body.user_ref,
    text: body.text,
    constraints: body.constraints,
  });
  return { intentId: intent.id, status: intent.status };
}

export async function cancelIntent(intentId: string): Promise<{ cancelled: boolean }> {
  const intent = await prisma.purchaseIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw new Error("Intent not found");
  if (intent.status === "DONE" || intent.status === "FAILED" || intent.status === "DENIED" || intent.status === "EXPIRED") {
    return { cancelled: false };
  }
  assertTransition(intent.status, "FAILED");
  await prisma.purchaseIntent.update({
    where: { id: intentId },
    data: { status: "FAILED" },
  });
  await emitEvent(intentId, "INTENT_CANCELLED", {});
  return { cancelled: true };
}

export async function acceptQuote(intentId: string, quote: QuotePayload): Promise<{ next: IntentStatus }> {
  const intent = await prisma.purchaseIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw new Error("Intent not found");
  assertTransition(intent.status, "QUOTED");

  await prisma.$transaction([
    prisma.quote.create({
      data: {
        intentId,
        title: quote.title,
        url: quote.url,
        amount: quote.amount,
        currency: quote.currency,
        merchantDomain: quote.merchant_domain,
        mccHint: quote.mcc_hint ?? undefined,
      },
    }),
    prisma.purchaseIntent.update({
      where: { id: intentId },
      data: { status: "QUOTED" },
    }),
  ]);
  await emitEvent(intentId, "QUOTE_ACCEPTED", quote);

  assertTransition("QUOTED", "AWAITING_APPROVAL");
  await prisma.purchaseIntent.update({
    where: { id: intentId },
    data: { status: "AWAITING_APPROVAL" },
  });
  await emitEvent(intentId, "AWAITING_APPROVAL", {});

  return { next: "AWAITING_APPROVAL" };
}

export async function createApprovalRequest(
  intentId: string,
  body: ApprovalRequestBody
): Promise<{ approvalId: string; status: string }> {
  const intent = await prisma.purchaseIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw new Error("Intent not found");
  if (intent.status !== "AWAITING_APPROVAL") throw new Error("Intent not in AWAITING_APPROVAL");

  const expiresAt = new Date(Date.now() + body.expires_in_seconds * 1000);
  const approval = await prisma.approval.create({
    data: {
      intentId,
      status: "AWAITING_APPROVAL",
      amount: body.amount,
      currency: body.currency,
      scopeJson: JSON.stringify(body.scope),
      expiresAt,
    },
  });
  await emitEvent(intentId, "APPROVAL_REQUEST_CREATED", {
    approval_id: approval.id,
    amount: body.amount,
    expires_at: expiresAt.toISOString(),
  });
  return { approvalId: approval.id, status: "AWAITING_APPROVAL" };
}

export async function recordApprovalDecision(
  approvalId: string,
  decision: "APPROVE" | "DENY",
  decidedBy: UserRef
): Promise<{ intentId: string; approvalStatus: "APPROVED" | "DENIED" }> {
  const approval = await prisma.approval.findUnique({
    where: { id: approvalId },
    include: { intent: true },
  });
  if (!approval) throw new Error("Approval not found");
  if (approval.status !== "AWAITING_APPROVAL") {
    return {
      intentId: approval.intentId,
      approvalStatus: approval.status === "APPROVED" ? "APPROVED" : "DENIED",
    };
  }
  if (new Date() > approval.expiresAt) {
    await prisma.approval.update({
      where: { id: approvalId },
      data: { status: "EXPIRED", decidedAt: new Date() },
    });
    await prisma.purchaseIntent.update({
      where: { id: approval.intentId },
      data: { status: "EXPIRED" },
    });
    await emitEvent(approval.intentId, "APPROVAL_EXPIRED", {});
    return { intentId: approval.intentId, approvalStatus: "DENIED" };
  }

  const approved = decision === "APPROVE";
  const newApprovalStatus = approved ? "APPROVED" : "DENIED";
  const newIntentStatus = approved ? "APPROVED" : "DENIED";

  if (approved) {
    await getOrCreatePurchasePot(
      approval.intent.userId,
      approval.intentId,
      approval.amount,
      approval.currency
    );
  }

  await prisma.$transaction([
    prisma.approval.update({
      where: { id: approvalId },
      data: { status: newApprovalStatus, decidedAt: new Date() },
    }),
    prisma.purchaseIntent.update({
      where: { id: approval.intentId },
      data: { status: newIntentStatus },
    }),
  ]);

  await emitEvent(approval.intentId, "APPROVAL_DECISION", {
    decision: newApprovalStatus,
    decided_by: decidedBy,
  });

  return { intentId: approval.intentId, approvalStatus: newApprovalStatus };
}

export async function issueCard(intentId: string): Promise<{
  cardId: string;
  stripeCardId: string;
  status: IntentStatus;
}> {
  const intent = await prisma.purchaseIntent.findUnique({
    where: { id: intentId },
    include: { approvals: { where: { status: "APPROVED" }, orderBy: { decidedAt: "desc" }, take: 1 } },
  });
  if (!intent) throw new Error("Intent not found");
  if (intent.status !== "APPROVED") throw new Error("Intent not APPROVED");
  const approval = intent.approvals[0];
  if (!approval) throw new Error("No approved approval for intent");

  const existing = await prisma.card.findFirst({ where: { intentId } });
  if (existing) {
    await prisma.purchaseIntent.update({
      where: { id: intentId },
      data: { status: "CARD_ISSUED" },
    });
    return {
      cardId: existing.id,
      stripeCardId: existing.stripeCardId,
      status: "CARD_ISSUED",
    };
  }

  const scope = JSON.parse(approval.scopeJson) as { merchant_domain?: string; mcc_allowlist?: string[] };
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const constraints: payments.CardConstraints = {
    amount_limit: approval.amount,
    currency: approval.currency,
    merchant_domain: scope.merchant_domain,
    mcc_allowlist: scope.mcc_allowlist,
    expires_at: expiresAt.toISOString(),
  };

  const created = await payments.createVirtualCard(intentId, constraints);

  await prisma.purchaseIntent.update({
    where: { id: intentId },
    data: { status: "CARD_ISSUED" },
  });
  await emitEvent(intentId, "CARD_ISSUED", {
    card_id: created.cardId,
    stripe_card_id: created.stripeCardId,
    last4: created.last4,
  });

  return {
    cardId: created.cardId,
    stripeCardId: created.stripeCardId,
    status: "CARD_ISSUED",
  };
}

export async function enqueueCheckout(intentId: string): Promise<{ jobId: string; status: string }> {
  const intent = await prisma.purchaseIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw new Error("Intent not found");
  assertTransition(intent.status, "CHECKOUT_RUNNING");

  const job = await checkoutQueue.add("checkout", { intentId });
  const dbJob = await prisma.job.create({
    data: {
      intentId,
      type: "CHECKOUT",
      status: "QUEUED",
      bullJobId: job.id,
    },
  });
  await prisma.purchaseIntent.update({
    where: { id: intentId },
    data: { status: "CHECKOUT_RUNNING" },
  });
  await emitEvent(intentId, "CHECKOUT_QUEUED", { job_id: dbJob.id, bull_job_id: job.id });
  return { jobId: dbJob.id, status: "QUEUED" };
}

export async function recordResult(
  intentId: string,
  status: "DONE" | "FAILED",
  summary?: string,
  artifacts: { type: string; url: string }[] = []
): Promise<void> {
  const intent = await prisma.purchaseIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw new Error("Intent not found");
  assertTransition(intent.status, status);

  await prisma.$transaction([
    prisma.result.create({
      data: {
        intentId,
        status,
        summary: summary ?? null,
        artifactsJson: JSON.stringify(artifacts),
      },
    }),
    prisma.purchaseIntent.update({
      where: { id: intentId },
      data: { status },
    }),
  ]);

  const job = await prisma.job.findFirst({
    where: { intentId, type: "CHECKOUT" },
    orderBy: { createdAt: "desc" },
  });
  if (job) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: status === "DONE" ? "DONE" : "FAILED" },
    });
  }

  await emitEvent(intentId, "RESULT_RECORDED", { status, summary, artifacts });
  if (status === "DONE") await payments.closeCard(intentId);
}

export async function getIntentDetails(intentId: string) {
  return prisma.purchaseIntent.findUnique({
    where: { id: intentId },
    include: {
      user: true,
      quotes: { orderBy: { createdAt: "desc" }, take: 1 },
      approvals: { orderBy: { createdAt: "desc" } },
      cards: { orderBy: { createdAt: "desc" }, take: 1 },
      jobs: { orderBy: { createdAt: "desc" } },
      results: { orderBy: { createdAt: "desc" }, take: 1 },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
}
