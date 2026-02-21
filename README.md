# Trusted Payment Infrastructure for Agents

A backend system enabling AI agents to complete shopping tasks on behalf of users — without ever accessing real bank credentials. The user approves a one-time budget; the backend issues a restricted Stripe virtual card; the agent uses it for a single checkout; the card is cancelled and the ledger settled.

## Architecture

```
Telegram (later) ──┐
OpenClaw worker ───┤──▶ API Gateway (Fastify :3000)
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

### Intent State Machine

```
RECEIVED → SEARCHING → QUOTED → AWAITING_APPROVAL → APPROVED → CARD_ISSUED → CHECKOUT_RUNNING → DONE
                                                   ↘ DENIED                                    ↘ FAILED
                                (any active state) → EXPIRED
```

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (for Postgres + Redis)
- Stripe account (test mode keys)

### 1. Install and configure
```bash
npm install
cp .env.example .env
# Edit .env — fill in STRIPE_SECRET_KEY from Stripe Dashboard (test mode)
```

### 2. Start infrastructure
```bash
docker compose up -d    # starts Postgres 16 + Redis 7
```

### 3. Migrate and seed
```bash
npm run db:migrate      # creates all tables
npm run seed            # creates demo user (demo@agentpay.dev, £1000 balance)
```

### 4. Start the server
```bash
npm run dev             # http://localhost:3000
```

### 5. (Optional) Start the stub worker
```bash
npm run worker          # processes BullMQ jobs, simulates OpenClaw
```

### 6. (Optional) Forward Stripe webhooks for local dev
```bash
stripe listen --forward-to localhost:3000/v1/webhooks/stripe
# Copy the whsec_... secret into .env as STRIPE_WEBHOOK_SECRET
```

## End-to-End Flow

Replace `USER_ID` with the ID from your seeded user (check DB or `GET /v1/debug/intents` after first intent).

### 1 — Create intent
```bash
curl -X POST http://localhost:3000/v1/intents \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -d '{"userId":"USER_ID","query":"Sony WH-1000XM5 headphones","maxBudget":30000,"currency":"gbp"}'
# → {"intentId":"clxxx...","status":"RECEIVED"}
```

### 2 — Post a quote (simulates worker search)
```bash
curl -X POST http://localhost:3000/v1/agent/quote \
  -H "Content-Type: application/json" \
  -H "X-Worker-Key: local-dev-worker-key" \
  -d '{"intentId":"INTENT_ID","merchantName":"Amazon UK","merchantUrl":"https://amazon.co.uk/dp/B09XS7JWHH","price":27999,"currency":"gbp"}'
# → intent moves to AWAITING_APPROVAL
```

### 3 — User approves the purchase
```bash
curl -X POST http://localhost:3000/v1/approvals/INTENT_ID/decision \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -d '{"decision":"APPROVED","actorId":"USER_ID"}'
# → intent moves to APPROVED, pot reserved in ledger
```

### 4 — Inspect status and audit trail
```bash
curl http://localhost:3000/v1/intents/INTENT_ID
curl http://localhost:3000/v1/debug/audit/INTENT_ID
```

### 5 — Worker posts checkout result
```bash
curl -X POST http://localhost:3000/v1/agent/result \
  -H "Content-Type: application/json" \
  -H "X-Worker-Key: local-dev-worker-key" \
  -d '{"intentId":"INTENT_ID","success":true,"actualAmount":27999,"receiptUrl":"https://amazon.co.uk/receipt/123"}'
# → intent moves to DONE
```

### 6 — Check ledger
```bash
curl http://localhost:3000/v1/debug/ledger/USER_ID
```

## API Reference

### External endpoints (Telegram-facing, later)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/intents` | — | Create purchase intent (`X-Idempotency-Key` required) |
| GET | `/v1/intents/:id` | — | Get intent + audit history |
| POST | `/v1/approvals/:id/decision` | — | Approve or deny intent |

### Worker endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/agent/quote` | `X-Worker-Key` | Post search quote |
| POST | `/v1/agent/result` | `X-Worker-Key` | Post checkout result |
| GET | `/v1/agent/card/:id` | `X-Worker-Key` | One-time card reveal |

### Webhooks
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/webhooks/stripe` | Stripe event receiver (signature verified) |

### Debug / Observability
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/debug/intents` | List all intents |
| GET | `/v1/debug/jobs` | Queue depths |
| GET | `/v1/debug/ledger/:userId` | User ledger + pot history |
| GET | `/v1/debug/audit/:intentId` | Intent audit trail |
| GET | `/health` | Health check |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `STRIPE_SECRET_KEY` | Stripe test-mode secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `WORKER_API_KEY` | Shared secret for worker endpoints |
| `PORT` | HTTP port (default: 3000) |

## Running Tests

```bash
npm test                                          # all unit tests
npm test -- --testPathPattern=e2e                 # E2E integration tests
npm test -- --testPathPattern=orchestrator        # state machine
npm test -- --testPathPattern=payments            # Stripe service
npm test -- --testPathPattern=api                 # API gateway
npm test -- --testPathPattern="policy|approval|ledger"  # policy + ledger
npm test -- --testPathPattern=queue               # BullMQ
```

## Security

- **No PAN/CVC storage** — `VirtualCard` DB record holds only `stripeCardId` + `last4`
- **One-time card reveal** — `GET /v1/agent/card/:id` sets `revealedAt`; second call returns 409
- **Worker authentication** — all `/v1/agent/*` routes require `X-Worker-Key`
- **Webhook verification** — Stripe webhooks verified with `stripe.webhooks.constructEvent()`
- **Idempotency** — all `POST` requests accept `X-Idempotency-Key`; duplicates replay stored responses

## Troubleshooting

**"Missing required env var: DATABASE_URL"**
→ Copy `.env.example` to `.env` and fill in values.

**"Can't reach database server at localhost:5432"**
→ Run `docker compose up -d`

**"Stripe webhook signature verification failed"**
→ Make sure `stripe listen --forward-to ...` is running and `STRIPE_WEBHOOK_SECRET` matches.

**Tests failing: "Cannot find module '@prisma/client'"**
→ Run `npx prisma generate` (generates the Prisma client with enums).

**BullMQ jobs not processing**
→ Start `npm run worker` and verify Redis is running: `docker compose ps`.
