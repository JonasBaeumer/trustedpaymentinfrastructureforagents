# Trusted Payment Infrastructure for Agents

A backend system enabling AI agents to complete shopping tasks on behalf of users -- without ever accessing real bank credentials. The user approves a one-time budget; the backend issues a restricted Stripe virtual card; the agent uses it for a single checkout; the card is cancelled and the ledger settled.

## Architecture

```
Telegram (later) ───┐
OpenClaw worker ────┤──▶ API Gateway (Fastify)
Stripe webhooks ────┘          │
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

### 1. Clone and install
```bash
git clone <repo>
cd trustedpaymentinfrastructureforagents
npm install
cp .env.example .env
# Edit .env -- add your STRIPE_SECRET_KEY
```

### 2. Start infrastructure
```bash
docker compose up -d   # starts Postgres + Redis
```

### 3. Run migrations + seed
```bash
npm run db:migrate     # creates tables
npm run seed           # creates demo user (demo@agentpay.dev, 1000 GBP balance)
```

### 4. Start the API server
```bash
npm run dev            # http://localhost:3000
```

### 5. (Optional) Start the stub worker
```bash
npm run worker         # consumes BullMQ jobs, simulates OpenClaw
```

### 6. (Optional) Forward Stripe webhooks
```bash
stripe listen --forward-to localhost:3000/v1/webhooks/stripe
```

## End-to-End Flow (curl examples)

### Step 1 -- Get the demo user ID
```bash
# After seeding, find the user ID:
curl http://localhost:3000/v1/debug/intents   # or check DB directly
# For the examples below, replace USER_ID with your seeded user's ID
```

### Step 2 -- Create a purchase intent
```bash
curl -X POST http://localhost:3000/v1/intents \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -d '{"userId": "USER_ID", "query": "Sony WH-1000XM5 headphones", "maxBudget": 30000, "currency": "gbp"}'
# Response: {"intentId": "clxxx...", "status": "RECEIVED"}
```

### Step 3 -- Post a quote (simulates worker search result)
```bash
curl -X POST http://localhost:3000/v1/agent/quote \
  -H "Content-Type: application/json" \
  -H "X-Worker-Key: local-dev-worker-key" \
  -d '{"intentId": "INTENT_ID", "merchantName": "Amazon UK", "merchantUrl": "https://amazon.co.uk/dp/B09XS7JWHH", "price": 27999, "currency": "gbp"}'
# Intent moves to AWAITING_APPROVAL
```

### Step 4 -- Request approval (user approves budget)
```bash
curl -X POST http://localhost:3000/v1/approvals/INTENT_ID/decision \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -d '{"decision": "APPROVED", "actorId": "USER_ID"}'
# Intent moves to APPROVED
```

### Step 5 -- Check intent status + audit trail
```bash
curl http://localhost:3000/v1/intents/INTENT_ID
curl http://localhost:3000/v1/debug/audit/INTENT_ID
```

### Step 6 -- Post checkout result (simulates worker completing purchase)
```bash
curl -X POST http://localhost:3000/v1/agent/result \
  -H "Content-Type: application/json" \
  -H "X-Worker-Key: local-dev-worker-key" \
  -d '{"intentId": "INTENT_ID", "success": true, "actualAmount": 27999, "receiptUrl": "https://amazon.co.uk/receipt/123"}'
# Intent moves to DONE
```

### Step 7 -- Check ledger
```bash
curl http://localhost:3000/v1/debug/ledger/USER_ID
```

## API Reference

### External endpoints (Telegram-facing, later)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/intents` | Create purchase intent |
| GET | `/v1/intents/:intentId` | Get intent + status |
| POST | `/v1/approvals/:intentId/decision` | Approve or deny intent |

### Worker endpoints (requires `X-Worker-Key`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/agent/quote` | Post search result/quote |
| POST | `/v1/agent/result` | Post checkout result |
| GET | `/v1/agent/card/:intentId` | One-time card reveal |

### Webhooks
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/webhooks/stripe` | Stripe event receiver |

### Debug / Observability
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/debug/intents` | List all intents |
| GET | `/v1/debug/jobs` | Queue depths |
| GET | `/v1/debug/ledger/:userId` | User ledger history |
| GET | `/v1/debug/audit/:intentId` | Intent audit trail |
| GET | `/health` | Health check |

## Environment Variables
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agentpay
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_test_...          # get from Stripe dashboard (test mode)
STRIPE_WEBHOOK_SECRET=whsec_...       # from: stripe listen --forward-to ...
WORKER_API_KEY=local-dev-worker-key   # shared secret for worker endpoints
PORT=3000
```

## Running Tests
```bash
npm test                              # all unit tests
npm test -- --testPathPattern=api     # API gateway tests only
npm test -- --testPathPattern=orchestrator  # state machine tests
npm test -- --testPathPattern=payments     # Stripe service tests
npm test -- --testPathPattern=policy       # policy engine tests
npm test -- --testPathPattern=ledger       # ledger tests
npm test -- --testPathPattern=queue        # queue tests
npm test -- --testPathPattern=e2e          # E2E integration tests
```

## Troubleshooting

**"Missing required env var: DATABASE_URL"**
Copy `.env.example` to `.env` and fill in values.

**"Can't reach database server"**
Run `docker compose up -d` to start Postgres and Redis.

**"Stripe webhook signature verification failed"**
Make sure `stripe listen --forward-to localhost:3000/v1/webhooks/stripe` is running and `STRIPE_WEBHOOK_SECRET` matches the secret printed by that command.

**Tests failing with "Cannot find module '@/contracts'"**
Run `npx prisma generate` first to generate the Prisma client (needed for the enum re-exports).

**BullMQ jobs not processing**
Start the stub worker: `npm run worker`. Verify Redis is running: `docker compose ps`.
