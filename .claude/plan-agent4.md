# Agent 4 — Payments & Stripe Issuing: Implementation Plan

## Overview

Implement the Payments module: Stripe SDK client, spending controls builder, card service (issue/reveal/freeze/cancel), and webhook handler. All files go in `src/payments/`. Tests go in `tests/unit/payments/`.

## Files to Create

### 1. `src/payments/stripeClient.ts`
- Lazy singleton pattern for Stripe SDK initialization
- Read `STRIPE_SECRET_KEY` from env, throw if missing
- Pin `apiVersion: '2024-06-20'`

### 2. `src/payments/spendingControls.ts`
- `buildSpendingControls(amountInSmallestUnit, mccAllowlist?)` function
- Returns `Stripe.Issuing.CardCreateParams.SpendingControls`
- `per_authorization` interval, optional `allowed_categories`

### 3. `src/payments/cardService.ts`
Implement `ICardService` interface with 4 exported functions:

- **`issueVirtualCard`**: Create cardholder + virtual card. Use `intentId` as idempotency key. Store only `stripeCardId` + `last4` in DB. Never store PAN/CVC.
- **`revealCard`**: One-time reveal. Check `revealedAt`, throw `CardAlreadyRevealedError` if already revealed. Expand `number`/`cvc` from Stripe. Set `revealedAt`.
- **`freezeCard`**: Set card status to `inactive`. Update `frozenAt` in DB.
- **`cancelCard`**: Set card status to `canceled`. Update `cancelledAt` in DB.

Key decisions:
- No cardholder upsert (User model lacks `stripeCardholderId`). Create fresh cardholder per intent. Acceptable for hackathon.
- All Stripe calls wrapped in try/catch with structured error logging.

### 4. `src/payments/webhookHandler.ts`
- `handleStripeEvent(rawBody, signature)` function
- Verify signature with `constructEvent`
- Handle: `issuing_authorization.request` (auto-approve), `issuing_authorization.created`, `issuing_transaction.created`
- Log audit events to `AuditEvent` table
- Silent failure on audit logging (don't break webhook processing)

### 5. `src/payments/index.ts`
- Re-export public API from the module

## Tests to Create

### 6. `tests/unit/payments/spendingControls.test.ts`
- Test per-authorization limit creation
- Test no allowed_categories when mccAllowlist absent or empty
- Test allowed_categories when mccAllowlist provided
- Test large amounts

### 7. `tests/unit/payments/cardService.test.ts`
- Mock Stripe SDK and Prisma
- Test issueVirtualCard: cardholder creation, card creation with correct spending controls, idempotency key, DB persistence without PAN/CVC
- Test revealCard: throws CardAlreadyRevealedError on second call, sets revealedAt on first call
- Test freezeCard: calls Stripe update with inactive status

## Execution Order

1. Create `src/payments/stripeClient.ts`
2. Create `src/payments/spendingControls.ts`
3. Create `src/payments/cardService.ts`
4. Create `src/payments/webhookHandler.ts`
5. Create `src/payments/index.ts`
6. Create `tests/unit/payments/spendingControls.test.ts`
7. Create `tests/unit/payments/cardService.test.ts`
8. Run tests, fix any issues
9. Commit and notify team lead
