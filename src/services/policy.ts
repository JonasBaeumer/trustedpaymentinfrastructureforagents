import { prisma } from "../lib/db.js";

/** Sync validation for approval scope (amount range, domain present). */
export function validateApprovalScope(
  _intentId: string,
  amount: number,
  scope: { merchant_domain: string; mcc_allowlist?: string[] }
): string | null {
  if (amount <= 0 || amount > 1_000_000_00) return "Amount out of allowed range";
  if (!scope.merchant_domain?.length) return "merchant_domain required";
  return null;
}

/** Enforce merchant_domain matches quote allowlist for this intent (F3 scope enforcement). */
export async function validateApprovalScopeAgainstQuote(
  intentId: string,
  amount: number,
  scope: { merchant_domain: string; mcc_allowlist?: string[] }
): Promise<string | null> {
  const err = validateApprovalScope(intentId, amount, scope);
  if (err) return err;
  const constraints = await getIntentConstraints(intentId);
  if (constraints?.merchant_domain_allowlist?.length) {
    const domain = scope.merchant_domain.toLowerCase();
    const allowed = constraints.merchant_domain_allowlist.map((d) => d.toLowerCase());
    if (!allowed.includes(domain)) {
      return "merchant_domain not in allowlist for this intent";
    }
  }
  if (constraints?.max_budget != null && amount > constraints.max_budget) {
    return "amount exceeds max budget for this intent";
  }
  return null;
}

/** Get intent constraints (max_budget, allowlist) for policy. */
export async function getIntentConstraints(intentId: string): Promise<{
  max_budget?: number;
  merchant_domain_allowlist?: string[];
} | null> {
  const intent = await prisma.purchaseIntent.findUnique({
    where: { id: intentId },
    include: { quotes: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!intent) return null;
  // Constraints are not stored on intent in our schema; they're in the create body. For policy we can use quote amount as cap.
  const quote = intent.quotes[0];
  return {
    max_budget: quote ? quote.amount : undefined,
    merchant_domain_allowlist: quote ? [quote.merchantDomain] : undefined,
  };
}
