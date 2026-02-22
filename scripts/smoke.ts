#!/usr/bin/env tsx
/**
 * Quick smoke test: happy path only. Run against a live API.
 * Usage: API_BASE_URL=http://localhost:3000/v1 WORKER_API_KEY=your-key pnpm test:smoke
 */
const BASE = process.env.API_BASE_URL ?? "http://localhost:3000/v1";
const WORKER_KEY = process.env.WORKER_API_KEY ?? "test-worker-key";
const TELEGRAM = "smoke_" + Date.now();

async function fetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  return globalThis.fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers as object) },
  });
}

async function main() {
  console.log("Smoke test →", BASE);

  const r1 = await fetch("/intents", {
    method: "POST",
    body: JSON.stringify({
      user_ref: { type: "telegram", telegram_user_id: TELEGRAM },
      text: "Buy AirPods Pro",
      constraints: { max_budget: 25000, currency: "USD", merchant_domain_allowlist: ["apple.com"] },
    }),
  });
  if (!r1.ok) throw new Error(`Create intent: ${r1.status}`);
  const { intent_id } = (await r1.json()) as { intent_id: string };
  console.log("  intent_id:", intent_id);

  const r2 = await fetch("/agent/quote", {
    method: "POST",
    headers: { "X-Worker-Key": WORKER_KEY },
    body: JSON.stringify({
      intent_id,
      quote: {
        title: "AirPods Pro",
        url: "https://apple.com/p",
        amount: 25000,
        currency: "USD",
        merchant_domain: "apple.com",
      },
    }),
  });
  if (!r2.ok) throw new Error(`Quote: ${r2.status}`);
  console.log("  quote → AWAITING_APPROVAL");

  const r3 = await fetch(`/intents/${intent_id}/approval/request`, {
    method: "POST",
    body: JSON.stringify({
      amount: 25000,
      currency: "USD",
      scope: { merchant_domain: "apple.com" },
      expires_in_seconds: 900,
    }),
  });
  if (!r3.ok) throw new Error(`Approval request: ${r3.status}`);
  const { approval_id } = (await r3.json()) as { approval_id: string };

  const r4 = await fetch(`/approvals/${approval_id}/decision`, {
    method: "POST",
    body: JSON.stringify({
      decision: "APPROVE",
      decided_by: { type: "telegram", telegram_user_id: TELEGRAM },
    }),
  });
  if (!r4.ok) throw new Error(`Approve: ${r4.status}`);
  console.log("  approved → card issued, checkout queued");

  const r5 = await fetch(`/intents/${intent_id}/card/reveal`, {
    method: "POST",
    headers: { "X-Worker-Key": WORKER_KEY },
    body: JSON.stringify({}),
  });
  if (!r5.ok) throw new Error(`Reveal: ${r5.status}`);
  console.log("  card revealed");

  const r6 = await fetch("/agent/result", {
    method: "POST",
    headers: { "X-Worker-Key": WORKER_KEY },
    body: JSON.stringify({
      intent_id,
      status: "DONE",
      summary: "Smoke test order",
      artifacts: [],
    }),
  });
  if (!r6.ok) throw new Error(`Result: ${r6.status}`);
  console.log("  result DONE");

  const r7 = await fetch(`/intents/${intent_id}`);
  const body = (await r7.json()) as { intent?: { status: string }; result?: unknown };
  if (body.intent?.status !== "DONE") throw new Error(`Expected DONE, got ${body.intent?.status}`);
  console.log("  intent status: DONE");
  console.log("Smoke test OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
