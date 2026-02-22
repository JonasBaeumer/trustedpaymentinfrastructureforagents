import { describe, it, expect, beforeAll } from "vitest";
import { api, pollIntentUntil } from "../helpers/api.js";

const TELEGRAM_USER = "e2e_telegram_" + Date.now();
const WORKER_KEY = api.workerKey;

describe("Happy path", () => {
  let intentId: string;
  let approvalId: string;

  it("1. Create intent", async () => {
    const r = await api.post("/intents", {
      user_ref: { type: "telegram", telegram_user_id: TELEGRAM_USER },
      text: "Buy latest AirPods Pro",
      constraints: {
        max_budget: 25000,
        currency: "USD",
        merchant_domain_allowlist: ["apple.com"],
      },
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as { intent_id: string; status: string };
    expect(body.status).toBe("RECEIVED");
    intentId = body.intent_id;
  });

  it("2. Worker posts quote → AWAITING_APPROVAL", async () => {
    const r = await api.postWithWorker("/agent/quote", {
      intent_id: intentId,
      quote: {
        title: "AirPods Pro (2nd gen)",
        url: "https://www.apple.com/shop/product/xxx",
        amount: 25000,
        currency: "USD",
        merchant_domain: "apple.com",
        mcc_hint: "electronics",
      },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; next: string };
    expect(body.ok).toBe(true);
    expect(body.next).toBe("AWAITING_APPROVAL");

    const getR = await api.get(`/intents/${intentId}`);
    expect(getR.status).toBe(200);
    const getBody = (await getR.json()) as { intent: { status: string } };
    expect(getBody.intent.status).toBe("AWAITING_APPROVAL");
  });

  it("3. Create approval request", async () => {
    const r = await api.post(`/intents/${intentId}/approval/request`, {
      amount: 25000,
      currency: "USD",
      scope: { merchant_domain: "apple.com", mcc_allowlist: ["5732", "5942"] },
      expires_in_seconds: 900,
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as { approval_id: string; status: string };
    approvalId = body.approval_id;
    expect(body.status).toBe("AWAITING_APPROVAL");
  });

  it("4. User approves → pot/ledger, card issued, checkout enqueued", async () => {
    const r = await api.post(`/approvals/${approvalId}/decision`, {
      decision: "APPROVE",
      decided_by: { type: "telegram", telegram_user_id: TELEGRAM_USER },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { intent_id: string; approval_status: string };
    expect(body.approval_status).toBe("APPROVED");

    const getR = await api.get(`/intents/${intentId}`);
    expect(getR.status).toBe(200);
    const getBody = (await getR.json()) as {
      intent: { status: string };
      approval: { status: string };
      card: { id: string; stripe_card_id: string; status: string } | null;
      jobs: { type: string; status: string }[];
    };
    expect(["APPROVED", "CARD_ISSUED", "CHECKOUT_RUNNING"]).toContain(getBody.intent.status);
    expect(getBody.approval.status).toBe("APPROVED");
    expect(getBody.card).toBeTruthy();
    expect(getBody.card!.stripe_card_id).toBeTruthy();
    const checkoutJob = getBody.jobs.find((j) => j.type === "CHECKOUT");
    expect(checkoutJob).toBeTruthy();
  });

  it("5. Simulate worker: card/reveal then agent/result DONE", async () => {
    const revealR = await api.postWithWorker(`/intents/${intentId}/card/reveal`, {});
    expect(revealR.status).toBe(200);
    const revealBody = (await revealR.json()) as { card: { pan: string }; constraints: unknown };
    expect(revealBody.card?.pan).toBeTruthy();

    const resultR = await api.postWithWorker("/agent/result", {
      intent_id: intentId,
      status: "DONE",
      summary: "E2E test order placed",
      artifacts: [{ type: "screenshot", url: "https://example.com/e2e.png" }],
    });
    expect(resultR.status).toBe(200);
  });

  it("6. Intent reaches DONE, result exists, card REVEALED/CLOSED", async () => {
    const { status, body } = await pollIntentUntil(intentId, ["DONE"], 10_000);
    expect(status).toBe("DONE");

    const b = body as {
      result: { status: string; summary: string; artifacts: unknown[] };
      card: { status: string };
    };
    expect(b.result).toBeTruthy();
    expect(b.result.status).toBe("DONE");
    expect(b.result.summary).toContain("E2E");
    expect(b.card.status).toMatch(/REVEALED|CLOSED/);
  });

  it("7. Card reveal cannot be called twice", async () => {
    const r = await api.postWithWorker(`/intents/${intentId}/card/reveal`, {});
    expect(r.status).toBe(404); // or 400 - "already revealed"
    const body = (await r.json()) as { error?: string };
    expect(body.error?.toLowerCase()).toMatch(/not found|already|revealed/);
  });
});
