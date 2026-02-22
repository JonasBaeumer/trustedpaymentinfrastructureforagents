---
name: build-with-agent-team
description: Spawn an agent team to build the trusted payment infrastructure backend in parallel
user-invocable: true
---

Build the "Agent-Safe Shopping + Payments" backend. $ARGUMENTS

This is a TypeScript/Node.js monolith (Fastify + Prisma + BullMQ + Stripe Issuing).
Spawn 7 agents as described below. Follow the strict spawn order and contract handoff
protocol — agents must not guess types or interfaces; they must import from the shared
contracts Agent 1 publishes.

---

## Spawn Order & Contract Handoff Protocol

1. **Spawn Agent 1 (Schema & Contracts) first. Do not spawn any other agent until it completes.**
2. Agent 1 must write all shared TypeScript interfaces + enums to `src/contracts/` BEFORE
   finishing. These files are the single source of truth for inter-agent collaboration.
3. Once Agent 1 signals completion (and its tests pass + commit is done), spawn Agents 2–6 in parallel.
4. Agents 2–6 each import from `src/contracts/` for any shared types — they never redefine them.
5. Once ALL of Agents 2–6 signal completion (tests pass + commit done), spawn Agent 7 (QA).
6. Agent 7 runs all tests across the full codebase and commits the integration test suite.

Each agent must:
- Run its own tests before marking itself done (`npm test -- --testPathPattern=<their module>`)
- Only commit after all its tests pass (commit message: `feat(<module>): implement + unit tests`)
- Report completion with a brief summary of what was built and what the tests cover

---

## Agent 1 — Schema, DB & Shared Contracts (BLOCKING)

**Files owned:**
- `prisma/schema.prisma`
- `prisma/migrations/`
- `src/db/client.ts`
- `src/db/seed.ts`
- `src/contracts/intent.ts` — PurchaseIntent types, status enum, transition event enum
- `src/contracts/card.ts` — VirtualCard, CardReveal types
- `src/contracts/ledger.ts` — LedgerEntry, Pot, LedgerEntryType enum
- `src/contracts/jobs.ts` — SearchIntentJob, CheckoutIntentJob payloads
- `src/contracts/approval.ts` — ApprovalDecision, PolicyResult types
- `src/contracts/audit.ts` — AuditEvent type
- `src/contracts/index.ts` — re-exports everything
- `tests/unit/db/` — schema and seed tests

**Prisma models to define:**
- `User` — id, email, mainBalance, maxBudgetPerIntent, merchantAllowlist, mccAllowlist, createdAt
- `PurchaseIntent` — id, userId, query, maxBudget, currency, status (enum), metadata (JSON), idempotencyKey, createdAt, updatedAt, expiresAt
- `VirtualCard` — id, intentId, stripeCardId, last4, revealedAt (nullable), frozenAt, cancelledAt, createdAt
- `LedgerEntry` — id, userId, intentId, type (RESERVE|SETTLE|RETURN), amount, currency, createdAt
- `Pot` — id, userId, intentId, reservedAmount, settledAmount, status (ACTIVE|SETTLED|RETURNED), createdAt, updatedAt
- `ApprovalDecision` — id, intentId, decision (APPROVED|DENIED), actorId, reason, createdAt
- `AuditEvent` — id, intentId, actor, event, payload (JSON), createdAt
- `IdempotencyRecord` — id, key, responseBody (JSON), createdAt

**Contracts to publish (TypeScript, not just Prisma):**
- Export all enums: `IntentStatus`, `LedgerEntryType`, `PotStatus`, `ApprovalDecisionType`
- Export transition event enum: `IntentEvent` (INTENT_CREATED, QUOTE_RECEIVED, APPROVAL_REQUESTED, USER_APPROVED, USER_DENIED, CARD_ISSUED, CHECKOUT_STARTED, CHECKOUT_SUCCEEDED, CHECKOUT_FAILED, INTENT_EXPIRED)
- Export service interface stubs so other agents know what to implement:
  - `IOrchestrator`, `ICardService`, `IApprovalService`, `ILedgerService`, `IQueueProducer`

**Tests required:**
- Unit: Prisma client connects, seed creates test user with correct balance
- Unit: all contract enums are correctly typed and exhaustive

**Commit when done:** `feat(schema): prisma models, db client, and shared contracts`

---

## Agent 2 — API Gateway (depends on Agent 1 contracts)

**Files owned:**
- `src/app.ts`
- `src/server.ts`
- `src/api/routes/intents.ts`
- `src/api/routes/approvals.ts`
- `src/api/routes/agent.ts`
- `src/api/routes/webhooks.ts`
- `src/api/routes/debug.ts`
- `src/api/middleware/auth.ts`
- `src/api/middleware/idempotency.ts`
- `src/api/validators/` (Zod schemas — import types from `src/contracts/`)
- `src/config/env.ts`
- `tests/unit/api/` — middleware and validator tests
- `tests/integration/api/` — route-level tests with mocked services

**Route surface:**

External (Telegram later):
- `POST /v1/intents` — create intent; requires `X-Idempotency-Key`
- `POST /v1/approvals/:intentId/decision` — user approve/deny; requires `X-Idempotency-Key`
- `GET  /v1/intents/:intentId` — get intent + current status

Worker-facing (requires `X-Worker-Key` header):
- `POST /v1/agent/quote` — worker posts quote for a SEARCHING intent
- `POST /v1/agent/result` — worker posts checkout result
- `GET  /v1/agent/card/:intentId` — one-time card reveal (fails if already revealed)

Webhooks:
- `POST /v1/webhooks/stripe` — Stripe event receiver; verify signature before processing

Debug/Observability:
- `GET /v1/debug/intents` — list all intents with status and timestamps
- `GET /v1/debug/jobs` — list BullMQ queue depths and recent job statuses
- `GET /v1/debug/ledger/:userId` — full ledger history for a user
- `GET /v1/debug/audit/:intentId` — full audit trail for an intent

**Auth rules:**
- `X-Worker-Key` middleware: compare header against `WORKER_API_KEY` env var
- Stripe webhook: use `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`
- All other routes: open (leave a `// TODO: add user auth` comment)

**Idempotency middleware:**
- On every `POST` with `X-Idempotency-Key`: check `IdempotencyRecord` in DB
- If found: return stored response immediately (no re-processing)
- If not: process normally, store response before returning

**Tests required:**
- Unit: auth middleware rejects missing/wrong `X-Worker-Key`
- Unit: idempotency middleware replays stored response on duplicate key
- Unit: each Zod validator rejects invalid input
- Integration: each route returns correct HTTP status with mocked service layer

**Commit when done:** `feat(api): fastify gateway, routes, auth, idempotency, validators`

---

## Agent 3 — Orchestrator (State Machine)

**Files owned:**
- `src/orchestrator/stateMachine.ts`
- `src/orchestrator/transitions.ts`
- `src/orchestrator/intentService.ts`
- `tests/unit/orchestrator/` — state machine transition tests
- `tests/integration/orchestrator/` — full lifecycle with real DB

**Responsibilities:**
- Import `IntentStatus`, `IntentEvent` from `src/contracts/`
- `transitionIntent(intentId, event, payload?)`:
  - Validates the transition is legal (throw `IllegalTransitionError` if not)
  - Updates `PurchaseIntent.status` in DB
  - Appends `AuditEvent` for every transition
  - Calls downstream side effects:
    - On `USER_APPROVED` → call `ICardService.issueVirtualCard()`
    - On `CARD_ISSUED` → call `IQueueProducer.enqueueCheckout()`
    - On `CHECKOUT_SUCCEEDED` or `CHECKOUT_FAILED` → call `ILedgerService.settleIntent()` or `.returnIntent()`
- `getIntentWithHistory(intentId)` — returns intent + all AuditEvents ordered by createdAt

**Legal transition table:**
```
RECEIVED          + INTENT_CREATED      → SEARCHING
SEARCHING         + QUOTE_RECEIVED      → QUOTED
QUOTED            + APPROVAL_REQUESTED  → AWAITING_APPROVAL
AWAITING_APPROVAL + USER_APPROVED       → APPROVED
AWAITING_APPROVAL + USER_DENIED         → DENIED
APPROVED          + CARD_ISSUED         → CARD_ISSUED
CARD_ISSUED       + CHECKOUT_STARTED    → CHECKOUT_RUNNING
CHECKOUT_RUNNING  + CHECKOUT_SUCCEEDED  → DONE
CHECKOUT_RUNNING  + CHECKOUT_FAILED     → FAILED
<any active>      + INTENT_EXPIRED      → EXPIRED
```

**Tests required:**
- Unit: every legal transition succeeds and updates status correctly
- Unit: every illegal transition throws `IllegalTransitionError`
- Unit: `AuditEvent` is written on every transition
- Integration: full RECEIVED → DONE happy path against real DB

**Commit when done:** `feat(orchestrator): state machine, transitions, audit logging`

---

## Agent 4 — Payments & Stripe Issuing ⚠️ REQUIRES PLAN APPROVAL

**Before writing any code, fetch and read these Stripe documentation pages in order:**
1. https://docs.stripe.com/issuing/cards/virtual/issue-cards
2. https://docs.stripe.com/issuing/controls/spending-controls
3. https://docs.stripe.com/issuing/purchases/authorizations
4. https://docs.stripe.com/api/issuing/cards/object

Also read `.claude/rules/stripe.md` for project-specific gotchas (raw body for webhooks,
card number expansion, PAN storage rules). Only proceed to implementation after reading all four pages.

**Files owned:**
- `src/payments/stripeClient.ts`
- `src/payments/cardService.ts`
- `src/payments/webhookHandler.ts`
- `src/payments/spendingControls.ts`
- `tests/unit/payments/` — mocked Stripe SDK tests
- `tests/integration/payments/` — Stripe test mode against real API (skipped in CI without key)

**IMPORTANT — security rules:**
- NEVER store PAN, CVC, or full card number in the DB or logs
- `VirtualCard` DB record stores only: `stripeCardId`, `last4`, `intentId`
- Card reveal (`revealCard`) is destructive: sets `revealedAt`, throws on second call
- All Stripe SDK calls wrapped in try/catch with structured error logging

**Card issuance (`cardService.ts`):**
- `issueVirtualCard(intentId, amount, currency, options?)`:
  - Upsert a Stripe Issuing Cardholder for the user
  - Create a Stripe Issuing virtual card in test mode
  - Apply `spending_controls` from `buildSpendingControls()` helper
  - Persist only `stripeCardId` + `last4` to `VirtualCard` DB record
  - Return the full Stripe card object to the caller (Orchestrator decides who sees it)
- `revealCard(intentId)`:
  - Load `VirtualCard`, throw `CardAlreadyRevealedError` if `revealedAt` is set
  - Fetch ephemeral card details from Stripe
  - Set `revealedAt = now()` in DB
  - Return card number + CVC to caller
- `freezeCard(intentId)` / `cancelCard(intentId)` — kill switch, updates DB + Stripe

**Spending controls (`spendingControls.ts`):**
- `buildSpendingControls(amount, currency, mccAllowlist?)` → Stripe `spending_controls` object
- Apply per-authorization amount cap
- Apply MCC allowlist if provided
- Set card `cancellation_reason` TTL via metadata (actual expiry handled by Orchestrator)

**Webhook handler (`webhookHandler.ts`):**
- `handleStripeEvent(rawBody, signature)`:
  - Verify signature via `stripe.webhooks.constructEvent()`; throw on invalid
  - Route by event type:
    - `issuing_authorization.request` → log to AuditEvent, approve in test mode
    - `issuing_authorization.created` → log authorized amount
    - `issuing_transaction.created` → log final transaction amount

**Tests required:**
- Unit: `issueVirtualCard` calls Stripe SDK with correct spending controls (mock Stripe)
- Unit: `revealCard` throws on second call
- Unit: webhook handler rejects invalid signature
- Unit: `buildSpendingControls` produces correct Stripe object for various inputs
- Integration: create real card in Stripe test mode, verify last4 stored correctly (skipped if no key)

**Commit when done:** `feat(payments): stripe issuing, card service, webhook handler`

---

## Agent 5 — Policy, Approval & Monzo Ledger

**Files owned:**
- `src/policy/policyEngine.ts`
- `src/approval/approvalService.ts`
- `src/ledger/ledgerService.ts`
- `src/ledger/potService.ts`
- `tests/unit/policy/`
- `tests/unit/approval/`
- `tests/unit/ledger/`
- `tests/integration/ledger/` — DB-backed pot lifecycle test

**Policy engine (`policyEngine.ts`):**
- Import `PolicyResult` from `src/contracts/`
- `evaluateIntent(intent, user)` → `PolicyResult { allowed, reason? }`:
  - `amount <= user.maxBudgetPerIntent` (default $500)
  - Merchant domain in allowlist (if user has one set)
  - MCC category in allowed set (if user has restrictions)
  - User has not created >3 intents today (rate limit)
- Each rule evaluated and logged to `AuditEvent` regardless of outcome

**Approval service (`approvalService.ts`):**
- `requestApproval(intentId)` → transitions intent to AWAITING_APPROVAL
- `recordDecision(intentId, decision, actorId)`:
  - Validates intent is in AWAITING_APPROVAL (throw otherwise)
  - Stores `ApprovalDecision` record
  - Uses `intentId` as idempotency key (second call replays first result)
  - If APPROVED: calls `ILedgerService.reserveForIntent()` then orchestrator transition
  - If DENIED: calls orchestrator transition directly

**Ledger service (`ledgerService.ts`, `potService.ts`):**
- `reserveForIntent(userId, intentId, amount)`:
  - Checks `user.mainBalance >= amount` (throw `InsufficientFundsError` otherwise)
  - Wraps in DB transaction: create `Pot` (ACTIVE) + `LedgerEntry` (RESERVE)
  - Deducts from `mainBalance`, records `potBalance` on Pot
- `settleIntent(intentId, actualAmount)`:
  - Closes Pot (SETTLED) + `LedgerEntry` (SETTLE)
  - Returns `reservedAmount - actualAmount` surplus to `mainBalance`
- `returnIntent(intentId)`:
  - Full return to `mainBalance` (for FAILED / DENIED / EXPIRED)
  - `LedgerEntry` (RETURN), Pot → RETURNED

**Tests required:**
- Unit: each policy rule passes and fails correctly
- Unit: `recordDecision` is idempotent (second call returns first result)
- Unit: `reserveForIntent` throws on insufficient balance
- Unit: `settleIntent` returns correct surplus
- Integration: full reserve → settle flow against real DB, verify balance arithmetic

**Commit when done:** `feat(policy-ledger): policy engine, approval service, monzo pot simulation`

---

## Agent 6 — Job Queue & Worker Stub (replaces frontend agent)

**Role:** BullMQ infrastructure + a runnable local stub that simulates OpenClaw,
making the full backend testable end-to-end without a real agent.

**Files owned:**
- `src/queue/queues.ts`
- `src/queue/jobTypes.ts` (import payload types from `src/contracts/`)
- `src/queue/producers.ts`
- `src/worker/processors/searchProcessor.ts`
- `src/worker/processors/checkoutProcessor.ts`
- `src/worker/stubWorker.ts`
- `src/config/redis.ts`
- `tests/unit/queue/`
- `tests/integration/queue/` — enqueue + consume round-trip test

**Queue setup:**
- `search-queue` and `checkout-queue` as BullMQ `Queue` instances
- Redis connection from `REDIS_URL` env var

**Producers (`producers.ts`):**
- `enqueueSearch(intentId, payload: SearchIntentJob)` — jobId = intentId (deduplication)
- `enqueueCheckout(intentId, payload: CheckoutIntentJob)` — jobId = intentId

**Stub worker (`stubWorker.ts`) — runnable as `npx ts-node src/worker/stubWorker.ts`:**
- Registers a BullMQ `Worker` on `checkout-queue`
- On each job: waits 2s (simulates work), then calls `POST /v1/agent/result`
  with `X-Worker-Key` header and a success payload
- Logs: job received, processing, result posted, done

**Search stub (`searchProcessor.ts`):**
- Registers a BullMQ `Worker` on `search-queue`
- Immediately calls `POST /v1/agent/quote` with a fake quote
  (merchant: "Amazon UK", url: "https://amazon.co.uk/stub", price: matches job budget)

**Tests required:**
- Unit: `enqueueSearch` / `enqueueCheckout` call BullMQ `Queue.add` with correct jobId and payload
- Unit: processors call the correct backend endpoints (mock HTTP client)
- Integration: enqueue a job, consume it, verify the round-trip against a real Redis instance

**Commit when done:** `feat(queue): bullmq queues, producers, stub worker`

---

## Agent 7 — QA & Integration Tests (spawn AFTER Agents 2–6 complete)

**Role:** Owns all cross-module integration tests and the full happy-path E2E trace.
Does NOT modify implementation files — only adds test files and fixes any import/type issues.

**Files owned:**
- `tests/integration/e2e/happyPath.test.ts`
- `tests/integration/e2e/errorPaths.test.ts`
- `tests/integration/e2e/stripeWebhook.test.ts`

**Tests required:**

Happy path (full state machine trace):
1. Seed test user
2. `POST /v1/intents` → assert status RECEIVED, job enqueued on search-queue
3. Stub search processor auto-posts quote → assert status QUOTED → AWAITING_APPROVAL
4. `POST /v1/approvals/:id/decision` (APPROVED) → assert pot reserved, status APPROVED
5. Assert card issued in Stripe (mocked) → status CARD_ISSUED
6. Stub checkout processor posts result → assert status DONE
7. Assert ledger settled, pot SETTLED, balance arithmetic correct
8. Assert full audit trail has 7+ events in correct order

Error paths:
- Insufficient balance → approval rejected at ledger layer
- Duplicate idempotency key → replayed response, no double-processing
- Invalid `X-Worker-Key` → 401 on all `/v1/agent/*` routes
- Card reveal called twice → 409 on second call
- Illegal state transition (e.g., DONE → APPROVED) → 409

Stripe webhook:
- Valid signature → event processed
- Invalid signature → 400 rejected

**Commit when done:** `test(e2e): full happy path, error paths, webhook verification`

---

## Shared Conventions (all agents must follow)

- All imports of shared types: `import { ... } from '@/contracts'` (path alias set by Agent 1)
- Inter-service calls: direct function imports (monolith, not HTTP between services)
- No `any` types — use contracts or `unknown` with type guards
- All DB writes inside Prisma transactions where atomicity matters
- Structured logging: `{ level, message, intentId?, error? }` — no raw `console.log`
- Test runner: Jest + `@types/jest`; use `jest.mock()` for external dependencies (Stripe SDK, HTTP)
- Each agent's tests must pass in isolation: `npm test -- --testPathPattern=<module>`

## Environment variables required

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agentpay
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
WORKER_API_KEY=local-dev-worker-key
PORT=3000
```

Local Stripe webhook forwarding:
```
stripe listen --forward-to localhost:3000/v1/webhooks/stripe
```
