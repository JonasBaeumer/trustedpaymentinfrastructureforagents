# Trusted Payment Infrastructure for Agents

> The secure payment rail every AI agent runs on. The agent can't spend a cent more than you said.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-4.x-black?logo=fastify)](https://fastify.dev/)
[![Stripe Issuing](https://img.shields.io/badge/Stripe-Issuing-635BFF?logo=stripe)](https://stripe.com/docs/issuing)
[![Tests](https://img.shields.io/badge/tests-193%20passing-brightgreen)](#running-tests)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)


```mermaid
flowchart TB
      subgraph Clients["External Clients"]
          TG["Telegram Bot\n(User)"]
          OC["OpenClaw Worker\n(AI Agent)"]
          SW["Stripe\n(Webhooks)"]
      end

      subgraph API["API Gateway  ·  Fastify + TypeScript"]
          direction TB
          R_INT["POST /v1/intents\nGET  /v1/intents/:id"]
          R_APR["POST /v1/approvals/:id/decision"]
          R_AGT["POST /v1/agent/quote\nPOST /v1/agent/result\nGET  /v1/agent/decision\nGET  /v1/agent/card\nPOST /v1/agent/register\nGET  /v1/agent/user"]
          R_WH["POST /v1/webhooks/stripe\nPOST /v1/webhooks/telegram"]
          R_CHK["POST /v1/checkout/simulate"]
          R_DBG["GET /v1/debug/*"]
          MW_AUTH["Middleware: X-Worker-Key Auth"]
          MW_IDEM["Middleware: Idempotency"]
      end

      subgraph Orchestrator["Orchestrator  ·  State Machine"]
          SM["stateMachine.ts\ntransitionIntent()"]
          IS["intentService.ts\nstartSearching / receiveQuote\napproveIntent / denyIntent\nmarkCardIssued / startCheckout\ncompleteCheckout / failCheckout"]
          TR["transitions.ts\nTRANSITION_TABLE\nACTIVE_STATES"]
      end

      subgraph Payments["Payments  ·  Stripe Issuing"]
          CS["cardService.ts\nissueVirtualCard\nrevealCard / freezeCard / cancelCard"]
          SC["stripeClient.ts\nStripe SDK singleton"]
          SP["spendingControls.ts\nbuildSpendingControls()"]
          WH["webhookHandler.ts\nhandleStripeEvent()"]
          SIM["checkoutSimulator.ts\nrunSimulatedCheckout()"]
      end

      subgraph PolicyLedger["Policy & Ledger"]
          PE["policyEngine.ts\nevaluateIntent()\n— budget check\n— merchant allowlist\n— MCC allowlist\n— rate limits"]
          POT["potService.ts\nreserveForIntent\nsettleIntent / returnIntent"]
      end

      subgraph ApprovalSvc["Approval Service"]
          AS["approvalService.ts\nrequestApproval()\nrecordDecision()"]
      end

      subgraph TelegramMod["Telegram Module"]
          TC["telegramClient.ts\ngrammy Bot singleton"]
          NS["notificationService.ts\nsendApprovalRequest()"]
          CB["callbackHandler.ts\nhandleTelegramCallback()"]
          SH["signupHandler.ts\nhandleTelegramMessage()"]
          SS["sessionStore.ts\nRedis signup sessions"]
      end

      subgraph Queue["Job Queue  ·  BullMQ"]
          SQ["searchQueue\nSearch jobs"]
          CQ["checkoutQueue\nCheckout jobs"]
          PR["producers.ts\nenqueueSearch()\nenqueueCheckout()"]
      end

      subgraph Worker["Stub Worker  ·  BullMQ Workers"]
          SP2["searchProcessor.ts\n→ POST /v1/agent/quote"]
          CP["checkoutProcessor.ts\n→ POST /v1/agent/result"]
      end

      subgraph Infra["Infrastructure"]
          DB[("PostgreSQL\nvia Prisma")]
          RD[("Redis\nioredis / BullMQ")]
          STRIPE[("Stripe API\ntest mode")]
      end

      TG -->|"HTTPS"| R_WH
      OC -->|"HTTPS + X-Worker-Key"| R_AGT
      SW -->|"HTTPS + stripe-sig"| R_WH

      R_INT --> Orchestrator
      R_APR --> ApprovalSvc
      R_AGT --> MW_AUTH --> Orchestrator
      R_AGT --> CS
      R_WH --> WH
      R_WH --> TelegramMod
      R_CHK --> SIM

      Orchestrator --> DB
      ApprovalSvc --> Orchestrator
      ApprovalSvc --> NS
      CS --> SC --> STRIPE
      CS --> DB
      WH --> SC
      SIM --> SC

      PolicyLedger --> DB
      TelegramMod --> DB
      TelegramMod --> ApprovalSvc
      TelegramMod --> POT
      TelegramMod --> CS
      TelegramMod --> Orchestrator
      SS --> RD

      PR --> SQ --> RD
      PR --> CQ --> RD
      SQ --> Worker
      CQ --> Worker
```

```mermaid
stateDiagram-v2
      [*] --> RECEIVED : POST /v1/intents

      RECEIVED --> SEARCHING : INTENT_CREATED\nenqueueSearch()
      SEARCHING --> QUOTED : QUOTE_RECEIVED\nagent POST /quote

      QUOTED --> AWAITING_APPROVAL : APPROVAL_REQUESTED\nreserveForIntent()\nsendApprovalRequest()

      AWAITING_APPROVAL --> APPROVED : USER_APPROVED\n(Telegram callback\nor POST /decision)
      AWAITING_APPROVAL --> DENIED : USER_DENIED\nreturnIntent()

      APPROVED --> CARD_ISSUED : CARD_ISSUED\nissueVirtualCard()
      CARD_ISSUED --> CHECKOUT_RUNNING : CHECKOUT_STARTED\nenqueueCheckout()

      CHECKOUT_RUNNING --> DONE : CHECKOUT_SUCCEEDED\nsettleIntent()\ncancelCard()
      CHECKOUT_RUNNING --> FAILED : CHECKOUT_FAILED\nreturnIntent()\nfreezeCard()

      RECEIVED --> EXPIRED : INTENT_EXPIRED
      SEARCHING --> EXPIRED : INTENT_EXPIRED
      QUOTED --> EXPIRED : INTENT_EXPIRED
      AWAITING_APPROVAL --> EXPIRED : INTENT_EXPIRED
      APPROVED --> EXPIRED : INTENT_EXPIRED
      CARD_ISSUED --> EXPIRED : INTENT_EXPIRED
      CHECKOUT_RUNNING --> EXPIRED : INTENT_EXPIRED

      DONE --> [*]
      FAILED --> [*]
      DENIED --> [*]
      EXPIRED --> [*]

```

```mermaid
erDiagram
      User {
          String id PK
          String email UK
          Int    mainBalance
          Int    maxBudgetPerIntent
          String merchantAllowlist "String array"
          String mccAllowlist "String array"
          String stripeCardholderId "nullable"
          String telegramChatId "nullable"
          String agentId UK "nullable"
      }
      PairingCode {
          String id PK
          String code UK
          String agentId UK
          String claimedByUserId "nullable"
          DateTime expiresAt
      }
      PurchaseIntent {
          String id PK
          String userId FK
          String query
          String subject "nullable"
          Int    maxBudget
          String currency
          String status "IntentStatus enum"
          String idempotencyKey UK
          DateTime expiresAt "nullable"
      }
      VirtualCard {
          String id PK
          String intentId FK
          String stripeCardId UK
          String last4
          DateTime revealedAt "nullable"
          DateTime frozenAt "nullable"
          DateTime cancelledAt "nullable"
      }
      Pot {
          String id PK
          String intentId FK
          String userId FK
          Int    reservedAmount
          Int    settledAmount
          String status "PotStatus enum"
      }
      LedgerEntry {
          String id PK
          String userId FK
          String intentId FK
          String type "RESERVE | SETTLE | RETURN"
          Int    amount
          String currency
      }
      ApprovalDecision {
          String id PK
          String intentId FK
          String decision "APPROVED | DENIED"
          String actorId
          String reason "nullable"
      }
      AuditEvent {
          String id PK
          String intentId FK
          String actor
          String event
          Json   payload
      }

      User ||--o{ PurchaseIntent : "creates"
      User ||--o{ Pot : "holds"
      User ||--o{ LedgerEntry : "has"
      PurchaseIntent ||--o| VirtualCard : "gets"
      PurchaseIntent ||--o| Pot : "has"
      PurchaseIntent ||--o| ApprovalDecision : "has"
      PurchaseIntent ||--o{ LedgerEntry : "generates"
      PurchaseIntent ||--o{ AuditEvent : "logs"
```

```mermaid
sequenceDiagram
      actor User
      participant TG as Telegram Bot
      participant API as Fastify API
      participant Orch as Orchestrator
      participant Policy as PolicyEngine
      participant Ledger as PotService
      participant Queue as BullMQ
      participant Worker as Stub Worker
      participant Payments as CardService
      participant Stripe as Stripe Issuing

      User->>API: POST /v1/intents\n{ query, maxBudget }
      API->>Orch: startSearching(intentId)
      Orch-->>API: status=SEARCHING
      API->>Queue: enqueueSearch(intentId)

      Queue->>Worker: SEARCH_INTENT job
      Worker->>API: POST /v1/agent/quote\n{ price, merchantName }
      API->>Orch: receiveQuote(intentId, quote)
      Orch-->>API: status=QUOTED
      API->>Policy: evaluateIntent(intent, user)
      Policy-->>API: { allowed: true }
      API->>Ledger: reserveForIntent(userId, amount)
      API->>Orch: requestApproval(intentId)
      Orch-->>API: status=AWAITING_APPROVAL
      API->>TG: sendApprovalRequest(intentId)

      TG->>User: "Approve €X at Merchant? [✅ Approve] [❌ Reject]"
      User->>TG: tap Approve
      TG->>API: POST /v1/webhooks/telegram\n{ callback: "approve:<id>" }
      API->>Orch: approveIntent(intentId)
      Orch-->>API: status=APPROVED
      API->>Payments: issueVirtualCard(intentId, amount)
      Payments->>Stripe: cardholders.create + cards.create\nspending_limit=budget
      Stripe-->>Payments: cardId, last4
      Payments-->>API: VirtualCard saved
      API->>Orch: markCardIssued(intentId)
      Orch-->>API: status=CARD_ISSUED
      API->>Queue: enqueueCheckout(intentId)

      Queue->>Worker: CHECKOUT_INTENT job
      Worker->>API: GET /v1/agent/card/:intentId\n(one-time reveal)
      API->>Stripe: cards.retrieve(expand: [number,cvc])
      Stripe-->>API: PAN, CVC, expiry
      API-->>Worker: { number, cvc, expiry }
      Note over API: VirtualCard.revealedAt set — can't reveal again

      Worker->>Stripe: simulate checkout (testHelpers.authorizations.create)
      Stripe->>API: POST /v1/webhooks/stripe\nissuing_authorization.request
      API->>Stripe: authorizations.approve(authId)

      Worker->>API: POST /v1/agent/result\n{ success: true, actualAmount }
      API->>Orch: completeCheckout(intentId)
      Orch-->>API: status=DONE
      API->>Ledger: settleIntent(intentId, actualAmount)
      API->>Payments: cancelCard(intentId)
      Payments->>Stripe: cards.update(status: canceled)
```

---

## The Problem

AI agents are going from novelty to necessity — in your pocket, in your business, in your supply chain. By end of 2026, 40% of enterprise applications will have embedded AI agents. Less than 5% have them today.

Every single one of those agent transactions needs a trust layer.

But right now there is no trusted, scoped, auditable payment primitive for agents.

Not with your real card — that's the same as handing your PIN to a stranger and saying *"be responsible."*
Not with a shared corporate card — that's how you get a $40,000 AWS bill from a rogue script.

Now picture this: your agent gets confused. Or compromised. Or just… ambitious. And instead of €40 of groceries, it orders €4,000 of something you definitely didn't ask for.

---

## The Solution

**Trusted Payment Infrastructure for Agents** is a payment rail that any AI agent plugs into. It enforces your intent at the financial primitive level — not at the application level.

> *"Please — only this much, only this merchant, only right now, make no mistake."*

When an agent needs to make a purchase:

1. The user approves a specific amount for a specific task
2. A one-time Stripe virtual card is issued, capped to exactly that amount — enforced at the card network level, not in software
3. The agent uses the card. It cannot spend a cent more than approved.
4. The moment the transaction completes, the card is gone

If the agent gets it wrong — spends more, tries a different merchant, tries again an hour later — the card is already dead. There is nothing left to misuse.

**One-time. Budgeted. Categorised. Time-boxed. Auditable.**

> *"We don't limit what agents can do — we limit what they can spend."*

This service is **payment infrastructure**, not an agent orchestrator. It does not tell agents what to buy. It gives any agent framework, shopping assistant, or autonomous procurement system a wallet with a conscience — and lets the spending controls do the rest.

Every single one of those agent transactions needs a trust layer. **We are that layer.**

---

## Goals & Outcomes

| Goal | How it's achieved |
|------|------------------|
| Zero credential exposure | Agent receives only an `intentId`; raw card data never leaves the server |
| Hard budget enforcement | Stripe Issuing spending controls cap the card at the approved amount per-authorization |
| Full auditability | Every state transition, approval, and Stripe event is logged to `AuditEvent` |
| User control | Approval step is mandatory; user can deny at any point via Telegram or API |
| Idempotent, retry-safe | Every mutating endpoint accepts `X-Idempotency-Key`; duplicate requests replay the stored response |
| Works on any Stripe account | Checkout simulation uses `testHelpers.issuing.authorizations` — no "Raw card data APIs" opt-in required |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        External Clients                          │
│                                                                  │
│   Telegram Bot ──────┐                                           │
│   OpenClaw Agent ────┤──▶  API Gateway (Fastify :3000)           │
│   Stripe Webhooks ───┘         │                                 │
└────────────────────────────────┼─────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────────┐
              │                  │                       │
              ▼                  ▼                       ▼
     ┌─────────────┐    ┌────────────────┐    ┌──────────────────┐
     │ Orchestrator │    │ Payments        │    │ Policy & Ledger   │
     │ (state       │◀──▶│ (Stripe Issuing)│    │ (approval, pots,  │
     │  machine)    │    │                │    │  spending rules)  │
     └──────┬───────┘    └────────────────┘    └──────────────────┘
            │
            ▼
   ┌──────────────────┐        ┌──────────────────┐
   │  Job Queue        │        │  Telegram Module  │
   │  (BullMQ/Redis)  │        │  (signup, notifs, │
   │                  │        │   callback handler)│
   └────────┬─────────┘        └──────────────────┘
            │
            ▼
   ┌──────────────────┐
   │  Stub Worker     │
   │  (simulates      │
   │   OpenClaw)      │
   └──────────────────┘

            ──────────────────────────────────
                    PostgreSQL (Prisma)
            ──────────────────────────────────
```

### Intent State Machine

Every purchase is a `PurchaseIntent` tracked through an explicit state machine. No transition happens without an explicit event — every step is audited.

```
         ┌─────────────────────────────────────────────────────────────┐
         │                     PurchaseIntent                           │
         │                                                              │
  POST /v1/intents                                                      │
         │                                                              │
         ▼                                                              │
     RECEIVED ──INTENT_CREATED──▶ SEARCHING ──QUOTE_RECEIVED──▶ QUOTED │
                                                                    │   │
                                                      APPROVAL_REQUESTED│
                                                                    │   │
                                                                    ▼   │
                                               AWAITING_APPROVAL ──┤   │
                                                    │          │   │   │
                                             USER_DENIED   USER_APPROVED│
                                                    │          │       │
                                                    ▼          ▼       │
                                                 DENIED     APPROVED   │
                                                               │       │
                                                         CARD_ISSUED   │
                                                               │       │
                                                               ▼       │
                                                         CARD_ISSUED ──┤
                                                               │       │
                                                      CHECKOUT_STARTED │
                                                               │       │
                                                               ▼       │
                                                      CHECKOUT_RUNNING ─┤
                                                          │         │   │
                                               CHECKOUT_SUCCEEDED  CHECKOUT_FAILED
                                                          │         │   │
                                                          ▼         ▼   │
                                                        DONE      FAILED│
                                                                        │
                                   (any active state) ─INTENT_EXPIRED──▶ EXPIRED
         └─────────────────────────────────────────────────────────────┘
```

---

## Codebase Structure

```
.
├── src/
│   ├── contracts/          # Shared TypeScript types — single source of truth
│   │   ├── intent.ts       # IntentStatus enum, IntentEvent enum, PurchaseIntent type
│   │   ├── card.ts         # VirtualCard, CardReveal types
│   │   ├── ledger.ts       # LedgerEntry, Pot, LedgerEntryType enum
│   │   ├── approval.ts     # ApprovalDecision, PolicyResult types
│   │   ├── jobs.ts         # SearchIntentJob, CheckoutIntentJob payloads
│   │   ├── audit.ts        # AuditEvent type
│   │   ├── agent.ts        # Agent registration types (PairingCode)
│   │   ├── errors.ts       # Typed error classes (IntentNotFoundError, etc.)
│   │   ├── services.ts     # Service interface stubs (IOrchestrator, etc.)
│   │   └── index.ts        # Re-exports everything
│   │
│   ├── api/
│   │   ├── routes/
│   │   │   ├── intents.ts       # POST /v1/intents, GET /v1/intents/:id
│   │   │   ├── approvals.ts     # POST /v1/approvals/:id/decision
│   │   │   ├── agent.ts         # /v1/agent/* (register, quote, decision, result, card)
│   │   │   ├── checkout.ts      # POST /v1/checkout/simulate
│   │   │   ├── webhooks.ts      # POST /v1/webhooks/stripe + /telegram
│   │   │   ├── telegram.ts      # POST /v1/users/:userId/link-telegram
│   │   │   └── debug.ts         # GET /v1/debug/* (intents, ledger, audit, jobs)
│   │   ├── middleware/
│   │   │   ├── auth.ts          # X-Worker-Key verification
│   │   │   └── idempotency.ts   # X-Idempotency-Key replay
│   │   └── validators/          # Zod schemas for each route
│   │
│   ├── orchestrator/
│   │   ├── stateMachine.ts      # Legal transition table + IllegalTransitionError
│   │   ├── transitions.ts       # transitionIntent() — DB update + side effects
│   │   └── intentService.ts     # getIntentWithHistory(), createIntent()
│   │
│   ├── payments/
│   │   ├── stripeClient.ts      # Singleton Stripe SDK instance
│   │   ├── cardService.ts       # issueVirtualCard(), revealCard(), freezeCard(), cancelCard()
│   │   ├── checkoutSimulator.ts # runSimulatedCheckout() via Stripe testHelpers
│   │   ├── spendingControls.ts  # buildSpendingControls() helper
│   │   └── webhookHandler.ts    # handleStripeEvent() — signature verify + event routing
│   │
│   ├── policy/
│   │   └── policyEngine.ts      # evaluateIntent() — budget cap, allowlists, rate limits
│   │
│   ├── approval/
│   │   └── approvalService.ts   # requestApproval(), recordDecision()
│   │
│   ├── ledger/
│   │   ├── potService.ts        # reserveForIntent(), settleIntent(), returnIntent()
│   │   └── ledgerService.ts     # Low-level LedgerEntry writes
│   │
│   ├── telegram/
│   │   ├── telegramClient.ts    # Singleton Bot via getTelegramBot()
│   │   ├── notificationService.ts # sendApprovalRequest() — inline keyboard to user
│   │   ├── callbackHandler.ts   # handleTelegramCallback() — approve/reject button presses
│   │   ├── signupHandler.ts     # handleTelegramMessage() — /start <code> signup flow
│   │   └── sessionStore.ts      # Redis-backed conversation state (TTL 10 min)
│   │
│   ├── queue/
│   │   ├── queues.ts            # BullMQ Queue instances (search-queue, checkout-queue)
│   │   ├── producers.ts         # enqueueSearch(), enqueueCheckout()
│   │   └── jobTypes.ts          # Job payload types (from contracts)
│   │
│   ├── worker/
│   │   ├── stubWorker.ts        # Local stub that simulates an OpenClaw agent
│   │   └── processors/
│   │       ├── searchProcessor.ts   # Consumes search-queue, posts fake quote
│   │       └── checkoutProcessor.ts # Consumes checkout-queue, posts result
│   │
│   ├── config/
│   │   ├── env.ts               # Validated env vars (Zod)
│   │   └── redis.ts             # Redis singleton
│   │
│   ├── db/
│   │   ├── client.ts            # Prisma client singleton
│   │   └── seed.ts              # Demo user seeder
│   │
│   ├── app.ts                   # Fastify app factory (buildApp)
│   └── server.ts                # Entry point (starts HTTP server)
│
├── prisma/
│   ├── schema.prisma            # DB models
│   └── migrations/              # Prisma migration history
│
├── tests/
│   ├── unit/                    # Pure logic tests (no DB/network)
│   │   ├── api/                 # Route, middleware, validator tests
│   │   ├── orchestrator/        # State machine tests
│   │   ├── payments/            # Stripe service tests (mocked SDK)
│   │   ├── policy/              # Policy engine tests
│   │   ├── approval/            # Approval service tests
│   │   ├── ledger/              # Pot/ledger arithmetic tests
│   │   ├── queue/               # BullMQ producer tests
│   │   └── telegram/            # Signup + callback handler tests
│   └── integration/
│       └── e2e/                 # Full-lifecycle tests (real DB + Redis + Stripe test mode)
│
└── docs/
    ├── openclaw.md              # OpenClaw agent integration guide
    └── telegram-setup.md        # Telegram bot setup guide
```

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **Docker** (for Postgres + Redis)
- **Stripe account** in test mode — `sk_test_*` key from the Dashboard
- **Telegram bot token** (optional) — for approval notifications and user signup; see [docs/telegram-setup.md](docs/telegram-setup.md)

### 1. Install and configure

```bash
git clone https://github.com/your-org/trustedpaymentinfrastructureforagents
cd trustedpaymentinfrastructureforagents
npm install
cp .env.example .env
```

Open `.env` and fill in at minimum:

```env
STRIPE_SECRET_KEY=sk_test_...
WORKER_API_KEY=local-dev-worker-key
```

Everything else has safe defaults for local development.

### 2. Start infrastructure

```bash
docker compose up -d    # starts Postgres 16 + Redis 7
```

### 3. Migrate and seed

```bash
npm run db:migrate      # creates all tables
npm run seed            # creates demo user: demo@agentpay.dev, £1 000 balance
```

### 4. Start the server

```bash
npm run dev             # hot-reload dev server on http://localhost:3000
```

### 5. (Optional) Start the stub worker

The stub worker simulates an OpenClaw agent: it picks up search jobs, posts a fake quote, then picks up checkout jobs and posts a result. This lets you exercise the full flow locally without a real agent.

```bash
npm run worker
```

### 6. (Optional) Forward Stripe webhooks

Required to receive Issuing authorization events during local testing.

```bash
stripe listen --forward-to localhost:3000/v1/webhooks/stripe
# Copy the printed whsec_... value into .env as STRIPE_WEBHOOK_SECRET
```

### 7. (Optional) Expose for Telegram

Telegram webhooks require a public HTTPS URL. Use [ngrok](https://ngrok.com) locally:

```bash
ngrok http 3000
# → Forwarding https://abc123.ngrok-free.app → localhost:3000
```

Register with Telegram (one-time, re-run if the ngrok URL changes):

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-ngrok-url>/v1/webhooks/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"],
    "drop_pending_updates": true
  }'
```

---

## End-to-End Flow

This is the full happy path. Replace `USER_ID` / `INTENT_ID` with real values.

### Step 1 — Create a purchase intent

```bash
curl -X POST http://localhost:3000/v1/intents \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -d '{
    "userId": "USER_ID",
    "query": "Sony WH-1000XM5 headphones",
    "maxBudget": 30000,
    "currency": "eur"
  }'
# ← { "intentId": "clxxx...", "status": "SEARCHING" }
```

The intent is immediately enqueued on `search-queue` for the agent to pick up.

### Step 2 — Agent posts a quote

```bash
curl -X POST http://localhost:3000/v1/agent/quote \
  -H "Content-Type: application/json" \
  -H "X-Worker-Key: local-dev-worker-key" \
  -d '{
    "intentId": "INTENT_ID",
    "merchantName": "Amazon DE",
    "merchantUrl": "https://amazon.de/dp/B09XS7JWHH",
    "price": 27999,
    "currency": "eur"
  }'
# ← { "status": "AWAITING_APPROVAL" }
# Telegram notification sent to user if telegramChatId is set
```

### Step 3 — User approves

```bash
curl -X POST http://localhost:3000/v1/approvals/INTENT_ID/decision \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -d '{ "decision": "APPROVED", "actorId": "USER_ID" }'
# ← { "status": "CARD_ISSUED" }
# Budget reserved in ledger; virtual card issued in Stripe
```

### Step 4 — Agent polls for decision and checkout params

```bash
curl http://localhost:3000/v1/agent/decision/INTENT_ID \
  -H "X-Worker-Key: local-dev-worker-key"
# ← {
#     "intentId": "INTENT_ID",
#     "status": "APPROVED",
#     "checkout": { "intentId": "INTENT_ID", "amount": 27999, "currency": "eur" }
#   }
```

### Step 5 — Agent simulates checkout

```bash
curl -X POST http://localhost:3000/v1/checkout/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "intentId": "INTENT_ID",
    "amount": 27999,
    "currency": "eur",
    "merchantName": "Amazon DE"
  }'
# ← { "success": true, "chargeId": "iauth_...", "amount": 27999, "currency": "eur" }
# Stripe Issuing authorization created + captured; visible in Dashboard
```

### Step 6 — Agent reports the result

```bash
curl -X POST http://localhost:3000/v1/agent/result \
  -H "Content-Type: application/json" \
  -H "X-Worker-Key: local-dev-worker-key" \
  -d '{
    "intentId": "INTENT_ID",
    "success": true,
    "actualAmount": 27999,
    "receiptUrl": "https://amazon.de/order/123"
  }'
# ← { "status": "DONE" }
# Intent → DONE; ledger settled; pot closed; surplus returned to main balance
```

### Inspect the audit trail

```bash
curl http://localhost:3000/v1/debug/audit/INTENT_ID
curl http://localhost:3000/v1/debug/ledger/USER_ID
```

---

## OpenClaw Agent Integration

For the full agent integration guide — including registration, pairing, the decision polling loop, and the complete API contract — see [docs/openclaw.md](docs/openclaw.md).

The key design principle: **OpenClaw never handles raw card credentials**. The decision endpoint returns exactly what the simulate endpoint needs:

```
GET  /v1/agent/decision/:intentId  →  { checkout: { intentId, amount, currency } }
POST /v1/checkout/simulate         ←  { intentId, amount, currency, merchantName }
```

The server resolves the Stripe card internally via the `intentId → VirtualCard → stripeCardId` lookup.

---

## Telegram Integration

For the full bot setup and signup flow guide see [docs/telegram-setup.md](docs/telegram-setup.md).

**What Telegram adds:**
- Users receive an inline-keyboard approval notification the moment a quote comes in
- Users tap **Approve** or **Reject** — no app, no browser needed
- New users sign up by starting the bot with a pairing code from OpenClaw: `/start <code>`

---

## API Reference

### User / Intent endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/intents` | — | Create purchase intent (`X-Idempotency-Key` required) |
| `GET` | `/v1/intents/:id` | — | Get intent + full audit history |
| `POST` | `/v1/approvals/:id/decision` | — | Approve or deny intent (`X-Idempotency-Key` required) |

### Agent / worker endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/agent/register` | `X-Worker-Key` | Register an OpenClaw instance; get a pairing code |
| `GET` | `/v1/agent/user` | `X-Worker-Key` + `X-Agent-Id` | Resolve `userId` after user completes signup |
| `POST` | `/v1/agent/quote` | `X-Worker-Key` | Post search quote for a `SEARCHING` intent |
| `GET` | `/v1/agent/decision/:intentId` | `X-Worker-Key` | Poll approval status; returns `checkout` params when approved |
| `POST` | `/v1/agent/result` | `X-Worker-Key` | Report checkout outcome; finalises the intent |
| `GET` | `/v1/agent/card/:intentId` | `X-Worker-Key` | One-time raw card reveal (alternative to the decision flow) |

### Checkout simulation

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| `POST` | `/v1/checkout/simulate` | — | `{ intentId, amount, currency?, merchantName? }` | Simulate a merchant charge via Stripe Issuing test helpers |

**Response codes:**

| Code | Meaning |
|------|---------|
| `200` | Charge approved and captured — `{ success: true, chargeId, amount, currency }` |
| `402` | Card declined — `{ success: false, declineCode, message }` |
| `400` | Validation error |
| `500` | Unexpected error |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/webhooks/stripe` | Stripe event receiver — signature verified with `STRIPE_WEBHOOK_SECRET` |
| `POST` | `/v1/webhooks/telegram` | Telegram update receiver — secret token verified |

### Telegram user management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/users/:userId/link-telegram` | — | Link a Telegram `chatId` to an existing user account |

### Debug / observability

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/debug/intents` | List all intents with status + timestamps |
| `GET` | `/v1/debug/jobs` | BullMQ queue depths and recent job statuses |
| `GET` | `/v1/debug/ledger/:userId` | Full ledger + pot history for a user |
| `GET` | `/v1/debug/audit/:intentId` | Full audit trail for an intent |
| `GET` | `/health` | Health check |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection string |
| `STRIPE_SECRET_KEY` | Yes | — | Stripe test-mode key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Yes | — | Stripe webhook signing secret (`whsec_...`) |
| `WORKER_API_KEY` | Yes | `local-dev-worker-key` | Shared secret for agent endpoints |
| `TELEGRAM_BOT_TOKEN` | No | — | Telegram bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | No | — | Secret token for Telegram webhook verification |
| `TELEGRAM_TEST_CHAT_ID` | No | — | Chat ID for local integration smoke tests |
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | `development` | `development` / `test` / `production` |

---

## Running Tests

```bash
# All unit tests (fast, no external deps)
npm test

# Specific module
npm test -- --testPathPattern=orchestrator
npm test -- --testPathPattern=payments
npm test -- --testPathPattern=api
npm test -- --testPathPattern="policy|approval|ledger"
npm test -- --testPathPattern=queue
npm test -- --testPathPattern=telegram

# Integration tests (requires running Postgres + Redis + sk_test_* key)
npm run test:integration

# Single integration suite
npm run test:integration -- --testPathPattern=checkoutSimulator
npm run test:integration -- --testPathPattern=onboarding
```

Integration tests are skipped automatically when `STRIPE_SECRET_KEY` is not a `sk_test_*` key, so they are safe to run in CI with the appropriate secret.

---

## Security Model

| Concern | Mitigation |
|---------|-----------|
| Raw card PAN/CVC exposure | Never stored in DB or logs. `VirtualCard` holds only `stripeCardId` + `last4`. Agent receives only `intentId`. |
| Overspending | Stripe Issuing `spending_limits: [{ amount, interval: 'per_authorization' }]` enforced at the card network level. |
| One-time card use | Card is cancelled immediately after checkout succeeds or fails. |
| Double-spending | `revealedAt` prevents a second card reveal; `settleIntent` / `returnIntent` are idempotent. |
| Worker key leakage | `X-Worker-Key` is a server-side secret never sent to the end user. Restricted Stripe keys (`rk_*`) are recommended for production. |
| Webhook spoofing | Stripe webhooks verified via `stripe.webhooks.constructEvent()`. Telegram webhooks verified via secret token header. |
| Double-processing | `X-Idempotency-Key` middleware stores and replays responses. Approval decisions use `intentId` as their idempotency key. |

---

## Troubleshooting

**`"Missing required env var: DATABASE_URL"`**
→ Copy `.env.example` to `.env` and fill in the values.

**`"Can't reach database server at localhost:5432"`**
→ Run `docker compose up -d` and wait a few seconds for Postgres to initialise.

**`"Stripe webhook signature verification failed"`**
→ Ensure `stripe listen --forward-to ...` is running and `STRIPE_WEBHOOK_SECRET` in `.env` matches the `whsec_...` printed by the CLI.

**`"Cannot find module '@prisma/client'"`**
→ Run `npx prisma generate` to generate the Prisma client from the current schema.

**`"BullMQ jobs not processing"`**
→ Start `npm run worker` and verify Redis is running: `docker compose ps`.

**Integration tests failing with DB conflicts**
→ Run with `--runInBand`: `npm run test:integration -- --runInBand`.

**Telegram bot not receiving updates**
→ Check the ngrok URL is still the same (ngrok free tier changes on restart), then re-run the `setWebhook` curl command. See [docs/telegram-setup.md](docs/telegram-setup.md).

---

## Development Guide

### Adding a new route

1. Add the Zod schema to `src/api/validators/`
2. Add the route handler to the relevant file in `src/api/routes/`
3. Register the route in `src/app.ts`
4. Add unit tests in `tests/unit/api/`

### Adding a new intent event / transition

1. Add the event to `IntentEvent` in `src/contracts/intent.ts`
2. Add the transition to the legal transition table in `src/orchestrator/stateMachine.ts`
3. Add side effects in `src/orchestrator/transitions.ts`
4. Update unit tests in `tests/unit/orchestrator/`

### Module boundary rule

**Never import from another module's internal files.** Cross-module calls go through the public interface exported from that module's `index.ts`, or via direct function imports declared in `src/contracts/services.ts`.

---

## License

MIT
