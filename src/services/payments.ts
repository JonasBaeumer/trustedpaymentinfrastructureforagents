import Stripe from "stripe";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!config.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
  if (!stripe) stripe = new Stripe(config.STRIPE_SECRET_KEY);
  return stripe;
}

export interface CardConstraints {
  amount_limit: number;
  currency: string;
  merchant_domain?: string;
  mcc_allowlist?: string[];
  expires_at: string;
}

export interface IssuedCardDetails {
  pan: string;
  exp_month: number;
  exp_year: number;
  cvc: string;
}

// One-time card details for reveal (never persisted to DB)
const revealStore = new Map<string, IssuedCardDetails>();

/** Create a virtual card with spending controls. When STRIPE_SECRET_KEY is unset (e.g. e2e), create DB-only mock card. */
export async function createVirtualCard(
  intentId: string,
  constraints: CardConstraints
): Promise<{
  cardId: string;
  stripeCardId: string;
  last4: string;
  brand: string;
  details?: IssuedCardDetails;
}> {
  if (!config.STRIPE_SECRET_KEY) {
    const mockStripeId = `mock_ic_${intentId.slice(0, 8)}`;
    const details: IssuedCardDetails = {
      pan: "4242 4242 4242 4242",
      exp_month: 12,
      exp_year: 2028,
      cvc: "123",
    };
    revealStore.set(intentId, details);
    const expiresAt = new Date(constraints.expires_at);
    const dbCard = await prisma.card.create({
      data: {
        intentId,
        stripeCardId: mockStripeId,
        last4: "4242",
        brand: "visa",
        status: "ISSUED",
        expiresAt,
        constraintsJson: JSON.stringify(constraints),
        expMonth: 12,
        expYear: 2028,
      },
    });
    return { cardId: dbCard.id, stripeCardId: mockStripeId, last4: "4242", brand: "visa", details };
  }

  const s = getStripe();

  // Stripe Issuing: we need a Cardholder first. Use intent-based naming.
  const cardholder = await s.issuing.cardholders.create({
    name: `Intent ${intentId}`,
    type: "individual",
    billing: {
      address: {
        line1: "123 Demo St",
        city: "San Francisco",
        state: "CA",
        postal_code: "94111",
        country: "US",
      },
    },
  });

  const spendingControls: Stripe.Issuing.CardCreateParams.SpendingControls = {
    spending_limits: [
      {
        amount: constraints.amount_limit,
        interval: "per_authorization",
      },
    ],
  };

  const card = await s.issuing.cards.create({
    cardholder: cardholder.id,
    type: "virtual",
    currency: constraints.currency.toLowerCase() as "usd",
    spending_controls: spendingControls,
    metadata: { intent_id: intentId, merchant_domain: constraints.merchant_domain ?? "" },
  });

  const last4 = card.last4 ?? "4242";
  const brand = card.brand ?? "visa";

  // Retrieve with expand to get number/cvc once (test mode supports this for virtual cards)
  let details: IssuedCardDetails | undefined;
  try {
    const expanded = await s.issuing.cards.retrieve(card.id, {
      expand: ["number", "cvc"],
    });
    const num = (expanded as { number?: string }).number;
    const cvc = (expanded as { cvc?: string }).cvc;
    if (num && cvc) {
      details = {
        pan: num,
        exp_month: (expanded as { exp_month?: number }).exp_month ?? 12,
        exp_year: (expanded as { exp_year?: number }).exp_year ?? 2028,
        cvc,
      };
      revealStore.set(intentId, details);
    }
  } catch (_) {
    // Stripe may not return number in all environments; use placeholder on reveal
  }

  const expiresAt = new Date(constraints.expires_at);

  const dbCard = await prisma.card.create({
    data: {
      intentId,
      stripeCardId: card.id,
      last4,
      brand,
      status: "ISSUED",
      expiresAt,
      constraintsJson: JSON.stringify(constraints),
      // Store details only for one-time reveal if we have them (hackathon: often Stripe test doesn't return number)
      expMonth: details?.exp_month ?? 12,
      expYear: details?.exp_year ?? 2028,
    },
  });

  return {
    cardId: dbCard.id,
    stripeCardId: card.id,
    last4,
    brand,
    details,
  };
}

/** Return card details for one-time reveal. Uses in-memory store if available, else placeholder. */
export async function getRevealDetails(
  intentId: string
): Promise<{ card: IssuedCardDetails; constraints: CardConstraints } | null> {
  const card = await prisma.card.findFirst({
    where: { intentId },
    orderBy: { createdAt: "desc" },
  });
  if (!card || card.status === "CLOSED") return null;

  const constraints = JSON.parse(card.constraintsJson) as CardConstraints;
  const stored = revealStore.get(intentId);
  const cardDetails: IssuedCardDetails = stored ?? {
    pan: `4242 4242 4242 ${card.last4}`,
    exp_month: card.expMonth ?? 12,
    exp_year: card.expYear ?? 2028,
    cvc: "123",
  };

  return {
    card: cardDetails,
    constraints: {
      ...constraints,
      expires_at: card.expiresAt?.toISOString() ?? constraints.expires_at,
    },
  };
}

/** Mark card as revealed (one-time). Returns details and sets revealedAt. Clears in-memory store after. */
export async function revealCard(
  intentId: string
): Promise<{ card: IssuedCardDetails; constraints: CardConstraints } | null> {
  const card = await prisma.card.findFirst({
    where: { intentId },
    orderBy: { createdAt: "desc" },
  });
  if (!card || card.revealedAt) return null;

  const out = await getRevealDetails(intentId);
  if (!out) return null;

  revealStore.delete(intentId);
  await prisma.card.update({
    where: { id: card.id },
    data: { status: "REVEALED", revealedAt: new Date() },
  });

  return out;
}

/** Close/cancel card in Stripe and mark in DB. Skips Stripe API for mock cards. */
export async function closeCard(intentId: string): Promise<void> {
  const card = await prisma.card.findFirst({
    where: { intentId },
    orderBy: { createdAt: "desc" },
  });
  if (!card || card.status === "CLOSED") return;

  if (!card.stripeCardId.startsWith("mock_") && config.STRIPE_SECRET_KEY) {
    try {
      await getStripe().issuing.cards.update(card.stripeCardId, { status: "inactive" });
    } catch (_) {
      // best effort
    }
  }
  await prisma.card.update({
    where: { id: card.id },
    data: { status: "CLOSED" },
  });
}
