import { prisma } from "../lib/db.js";

const MAIN_BALANCE_POT_NAME = "main";
const PURCHASE_POT_PREFIX = "purchase_";

/** Get or create main "pot" (balance) for user. We simulate Monzo pots as ledger rows; main balance is sum of ledger. */
export async function getOrCreatePurchasePot(
  userId: string,
  intentId: string,
  amount: number,
  currency: string
): Promise<{ potId: string }> {
  const name = `${PURCHASE_POT_PREFIX}${intentId}`;
  const existing = await prisma.pot.findFirst({
    where: { userId, name },
  });
  if (existing) return { potId: existing.id };

  const pot = await prisma.pot.create({
    data: {
      userId,
      name,
      balanceAmount: amount,
      currency,
    },
  });

  await prisma.ledgerEntry.create({
    data: {
      userId,
      potId: pot.id,
      deltaAmount: amount,
      currency,
      reason: `Allocate to purchase pot for intent ${intentId}`,
    },
  });

  return { potId: pot.id };
}

/** Record that we've "spent" from the pot (on completion). For hackathon we assume exact spend; no partial return for now. */
export async function settlePot(potId: string, amount: number, reason: string): Promise<void> {
  const pot = await prisma.pot.findUnique({ where: { id: potId } });
  if (!pot) return;
  await prisma.$transaction([
    prisma.ledgerEntry.create({
      data: {
        userId: pot.userId,
        potId: pot.id,
        deltaAmount: -amount,
        currency: pot.currency,
        reason,
      },
    }),
    prisma.pot.update({
      where: { id: potId },
      data: { balanceAmount: { decrement: amount } },
    }),
  ]);
}
