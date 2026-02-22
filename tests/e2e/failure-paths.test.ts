import { describe, it, expect } from "vitest";
import { api } from "../helpers/api.js";

const WORKER_KEY = api.workerKey;

describe("F1: Deny approval", () => {
  it("Create intent -> quote -> deny -> no card, no checkout", async () => {
    const telegramId = "deny_test_" + Date.now();
    const cr = await api.post("/intents", {
      user_ref: { type: "telegram", telegram_user_id: telegramId },
      text: "Buy something",
      constraints: { max_budget: 10000, currency: "USD", merchant_domain_allowlist: ["allowed.com"] },
    });
    expect(cr.status).toBe(201);
    const { intent_id } = (await cr.json()) as { intent_id: string };

    await api.postWithWorker("/agent/quote", {
      intent_id,
      quote: {
        title: "Product",
        url: "https://allowed.com/p",
        amount: 5000,
        currency: "USD",
        merchant_domain: "allowed.com",
      },
    });

    const appReq = await api.post(`/intents/${intent_id}/approval/request`, {
      amount: 5000,
      currency: "USD",
      scope: { merchant_domain: "allowed.com" },
      expires_in_seconds: 900,
    });
    expect(appReq.status).toBe(201);
    const { approval_id } = (await appReq.json()) as { approval_id: string };

    const dec = await api.post(`/approvals/${approval_id}/decision`, {
      decision: "DENY",
      decided_by: { type: "telegram", telegram_user_id: telegramId },
    });
    expect(dec.status).toBe(200);
    const decBody = (await dec.json()) as { approval_status: string };
    expect(decBody.approval_status).toBe("DENIED");

    const getR = await api.get(`/intents/${intent_id}`);
    const getBody = (await getR.json()) as { intent: { status: string }; card: unknown; jobs: unknown[] };
    expect(getBody.intent.status).toBe("DENIED");
    expect(getBody.card).toBeNull();
    expect(getBody.jobs.filter((j: { type: string }) => j.type === "CHECKOUT").length).toBe(0);
  });
});

describe("F2: Idempotency - approve twice, same card", () => {
  it("Call approval decision twice with same approvalId -> only one card", async () => {
    const telegramId = "idem_test_" + Date.now();
    const cr = await api.post("/intents", {
      user_ref: { type: "telegram", telegram_user_id: telegramId },
      text: "Buy one item",
      constraints: { max_budget: 5000, currency: "USD", merchant_domain_allowlist: ["shop.com"] },
    });
    expect(cr.status).toBe(201);
    const { intent_id } = (await cr.json()) as { intent_id: string };

    await api.postWithWorker("/agent/quote", {
      intent_id,
      quote: {
        title: "Item",
        url: "https://shop.com/x",
        amount: 3000,
        currency: "USD",
        merchant_domain: "shop.com",
      },
    });

    const appReq = await api.post(`/intents/${intent_id}/approval/request`, {
      amount: 3000,
      currency: "USD",
      scope: { merchant_domain: "shop.com" },
      expires_in_seconds: 900,
    });
    const { approval_id } = (await appReq.json()) as { approval_id: string };

    const r1 = await api.post(`/approvals/${approval_id}/decision`, {
      decision: "APPROVE",
      decided_by: { type: "telegram", telegram_user_id: telegramId },
    });
    expect(r1.status).toBe(200);
    const get1 = await api.get(`/intents/${intent_id}`);
    const body1 = (await get1.json()) as { card: { id: string; stripe_card_id: string } };
    const cardId1 = body1.card?.id;
    const stripeId1 = body1.card?.stripe_card_id;

    const r2 = await api.post(`/approvals/${approval_id}/decision`, {
      decision: "APPROVE",
      decided_by: { type: "telegram", telegram_user_id: telegramId },
    });
    expect(r2.status).toBe(200);
    const get2 = await api.get(`/intents/${intent_id}`);
    const body2 = (await get2.json()) as { card: { id: string; stripe_card_id: string } };
    expect(body2.card?.id).toBe(cardId1);
    expect(body2.card?.stripe_card_id).toBe(stripeId1);
  });
});

describe("F3: Scope enforcement - merchant_domain not in allowlist", () => {
  it("Quote with allowed domain, approval request with different domain -> rejected", async () => {
    const cr = await api.post("/intents", {
      user_ref: { type: "telegram", telegram_user_id: "scope_test_" + Date.now() },
      text: "Buy",
      constraints: { max_budget: 10000, currency: "USD", merchant_domain_allowlist: ["apple.com"] },
    });
    expect(cr.status).toBe(201);
    const { intent_id } = (await cr.json()) as { intent_id: string };

    await api.postWithWorker("/agent/quote", {
      intent_id,
      quote: {
        title: "AirPods",
        url: "https://apple.com/p",
        amount: 20000,
        currency: "USD",
        merchant_domain: "apple.com",
      },
    });

    const r = await api.post(`/intents/${intent_id}/approval/request`, {
      amount: 20000,
      currency: "USD",
      scope: { merchant_domain: "evil.com" },
      expires_in_seconds: 900,
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error?: string };
    expect(body.error?.toLowerCase()).toMatch(/allowlist|merchant/);
  });
});

describe("F4: Card reveal protection", () => {
  it("Reveal without worker key -> 401", async () => {
    const r = await api.post(`/intents/some-fake-id/card/reveal`, {}, { "X-Worker-Key": "" });
    expect(r.status).toBe(401);
  });

  it("Reveal with wrong worker key -> 401", async () => {
    const r = await api.fetch("/intents/some-fake-id/card/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Worker-Key": "wrong-key" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(401);
  });

  it("Reveal for intent with no card (no approval) -> 404", async () => {
    const cr = await api.post("/intents", {
      user_ref: { type: "telegram", telegram_user_id: "nocard_" + Date.now() },
      text: "Buy",
      constraints: { max_budget: 1000, currency: "USD" },
    });
    const { intent_id } = (await cr.json()) as { intent_id: string };
    const r = await api.postWithWorker(`/intents/${intent_id}/card/reveal`, {});
    expect(r.status).toBe(404);
  });
});

describe("F5: Stripe webhook test bypass", () => {
  it.skip("POST webhook with STRIPE_WEBHOOK_TEST_BYPASS -> 2xx and event stored (skip when ignoring Stripe)", async () => {
    const r = await api.post("/webhooks/stripe", {
      id: "evt_test_" + Date.now(),
      type: "issuing_authorization.created",
      data: { object: { id: "auth_1", amount: 1000 } },
    });
    expect(r.status).toBeGreaterThanOrEqual(200);
    expect(r.status).toBeLessThan(300);
    const body = (await r.json()) as { received?: boolean };
    expect(body.received).toBe(true);
  });
});
