# CLAUDE.md

This file is loaded by every Claude Code session and agent teammate working in this repo.

## Project Overview

**Trusted Payment Infrastructure for Agents** — a backend system that lets AI agents (e.g. OpenClaw) complete shopping tasks on behalf of a user, with a one-time restricted budget, without ever accessing the user's real bank or card credentials.

The user approves a budget → the backend issues a restricted Stripe virtual card → the agent uses that card for a single checkout → the card is cancelled and the ledger is settled.

## Tech Stack

- **Runtime:** Node.js + TypeScript (strict mode)
- **HTTP:** Fastify
- **ORM:** Prisma + PostgreSQL
- **Queue:** BullMQ + Redis
- **Payments:** Stripe Issuing (test mode)
- **Validation:** Zod
- **Tests:** Jest

## Key Commands

```bash
# Install dependencies
npm install

# Database
npx prisma migrate dev          # run migrations
npx prisma migrate reset        # reset DB (dev only)
npx prisma studio               # browse DB

# Dev
npm run dev                     # start Fastify server (ts-node-dev)
npx ts-node src/worker/stubWorker.ts   # run the local stub worker

# Tests
npm test                        # all tests
npm test -- --testPathPattern=orchestrator   # single module
npm run test:integration        # integration tests only (requires running DB + Redis)

# Local infra
docker compose up -d            # start Postgres + Redis
docker compose down

# Stripe webhooks (local dev)
stripe listen --forward-to localhost:3000/v1/webhooks/stripe
```

## Architecture

```
Telegram bot ──────┐
OpenClaw worker ───┤──▶ API Gateway (Fastify)
Stripe webhooks ───┘          │
                              ├──▶ Orchestrator (state machine)
                              │         │
                              │         ├──▶ Payments Service (Stripe Issuing)
                              │         ├──▶ Policy & Approval Service
                              │         ├──▶ Ledger Service (Monzo pot simulation)
                              │         └──▶ Job Queue (BullMQ)
                              │                   │
                              │                   └──▶ Stub Worker (simulates OpenClaw)
                              └──▶ PostgreSQL (Prisma)
```

## Module Boundaries (file ownership per agent team)

| Module | Directory | Description |
|--------|-----------|-------------|
| Contracts | `src/contracts/` | Shared TypeScript types/interfaces — source of truth |
| DB | `prisma/`, `src/db/` | Schema, migrations, Prisma client |
| API Gateway | `src/api/`, `src/app.ts`, `src/server.ts` | Fastify routes, middleware, validators |
| Orchestrator | `src/orchestrator/` | PurchaseIntent state machine |
| Payments | `src/payments/` | Stripe Issuing card lifecycle |
| Policy + Ledger | `src/policy/`, `src/approval/`, `src/ledger/` | Rules engine, approvals, Monzo pots |
| Queue + Worker | `src/queue/`, `src/worker/`, `src/config/redis.ts` | BullMQ + stub worker |
| Telegram | `src/telegram/` | Bot client, approval notifications, user signup handler |

**Rule: never edit another module's files.** Cross-module calls use direct function imports from the published module interface, not HTTP.

## Shared Contracts

All shared TypeScript types and service interfaces live in `src/contracts/`. Import from there:

```ts
import { IntentStatus, IntentEvent, PolicyResult } from '@/contracts'
```

Never redefine types that already exist in `src/contracts/`. If a type is missing, add it there.

## Intent State Machine

```
RECEIVED → SEARCHING → QUOTED → AWAITING_APPROVAL → APPROVED → CARD_ISSUED → CHECKOUT_RUNNING → DONE
                                                   ↘ DENIED                                    ↘ FAILED
                                    (any active state) → EXPIRED
```

## Security Rules (non-negotiable)

- **Never store full card PAN, CVC, or expiry in the DB or logs.** `VirtualCard` stores only `stripeCardId` + `last4`.
- Card details are returned to the caller exactly once. `VirtualCard.revealedAt` is set on first reveal; subsequent calls throw `CardAlreadyRevealedError`.
- Worker endpoints (`/v1/agent/*`) require `X-Worker-Key` header verified against `WORKER_API_KEY` env var.
- Stripe webhooks must be verified with `stripe.webhooks.constructEvent()` before processing.
- All approval decisions use `intentId` as an idempotency key — no double-processing.

## Testing Requirements

Every module must have:
- **Unit tests** — pure logic, no DB/network (mock external deps with `jest.mock()`)
- **Integration tests** — real DB + Redis, covering the full module lifecycle

An agent must not commit until its own tests pass:
```bash
npm test -- --testPathPattern=<module>
```

Cross-module E2E tests live in `tests/integration/e2e/` and are owned by the QA agent.

## Environment Variables

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agentpay
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
WORKER_API_KEY=local-dev-worker-key
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
TELEGRAM_TEST_CHAT_ID=        # optional, local dev only
PORT=3000
```

Copy `.env.example` to `.env` for local dev.

## What Is NOT in Scope (yet)

- Real OpenClaw / Playwright worker (stub worker handles local testing)
- Production hardening, auth on user-facing routes, PII tokenization
