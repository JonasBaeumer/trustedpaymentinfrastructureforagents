import { config } from "./config.js";

const BASE = config.API_BASE_URL + "/v1";
const WORKER_KEY = config.WORKER_KEY;

export async function createIntent(telegramUserId: string, text: string, constraints: { max_budget?: number; currency?: string; merchant_domain_allowlist?: string[] }) {
  const r = await fetch(`${BASE}/intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_ref: { type: "telegram", telegram_user_id: String(telegramUserId) },
      text,
      constraints: {
        max_budget: constraints.max_budget ?? 100000,
        currency: constraints.currency ?? "USD",
        merchant_domain_allowlist: constraints.merchant_domain_allowlist ?? [],
      },
    }),
  });
  if (!r.ok) throw new Error(`createIntent: ${r.status} ${await r.text()}`);
  return r.json() as Promise<{ intent_id: string; status: string }>;
}

export async function getIntent(intentId: string) {
  const r = await fetch(`${BASE}/intents/${intentId}`);
  if (!r.ok) throw new Error(`getIntent: ${r.status}`);
  return r.json();
}

export async function createApprovalRequest(
  intentId: string,
  amount: number,
  currency: string,
  scope: { merchant_domain: string; mcc_allowlist?: string[] },
  expiresInSeconds: number
) {
  const r = await fetch(`${BASE}/intents/${intentId}/approval/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, currency, scope, expires_in_seconds: expiresInSeconds }),
  });
  if (!r.ok) throw new Error(`createApprovalRequest: ${r.status} ${await r.text()}`);
  return r.json() as Promise<{ approval_id: string; status: string }>;
}

export async function approvalDecision(
  approvalId: string,
  decision: "APPROVE" | "DENY",
  telegramUserId: string
) {
  const r = await fetch(`${BASE}/approvals/${approvalId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decision,
      decided_by: { type: "telegram", telegram_user_id: String(telegramUserId) },
    }),
  });
  if (!r.ok) throw new Error(`approvalDecision: ${r.status} ${await r.text()}`);
  return r.json() as Promise<{ intent_id: string; approval_status: string }>;
}

export async function postQuote(
  intentId: string,
  quote: { title: string; url: string; amount: number; currency: string; merchant_domain: string; mcc_hint?: string }
) {
  const r = await fetch(`${BASE}/agent/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Worker-Key": WORKER_KEY },
    body: JSON.stringify({ intent_id: intentId, quote }),
  });
  if (!r.ok) throw new Error(`postQuote: ${r.status} ${await r.text()}`);
  return r.json();
}
