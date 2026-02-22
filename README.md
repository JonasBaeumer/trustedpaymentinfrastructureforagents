# Agent-Safe Shopping + Payments (Backend)

Backend for an **agent-safe shopping + payments** system: an AI shopping agent can buy items on behalf of a user **without ever accessing real bank/card details**. The user approves a one-time budget; the backend issues a **restricted virtual card** (Stripe Issuing) with strict spending controls (amount limit, optional MCC/domain, short expiry). Monzo-style "pots" are simulated in the DB ledger.

## Architecture (high level)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  API Manager (Gateway) – single HTTP entrypoint                              │
│  /v1/*  →  validation (Zod), auth (X-Worker-Key for agent), idempotency      │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Orchestrator     │   │  Policy &        │   │  Payments        │
│  (state machine)  │◄──│  Approval        │   │  (Stripe Issuing) │
│  RECEIVED → … →   │   │  scope, budget,  │   │  virtual cards,   │
│  DONE/FAILED      │   │  ledger/pots     │   │  spending limits  │
└────────┬─────────┘   └──────────────────┘   └──────────────────┘
         │
         ▼
┌──────────────────┐   ┌──────────────────┐
│  Job Queue        │   │  DB (Postgres)   │
│  BullMQ (Redis)   │   │  intents, quotes,│
│  SEARCH / CHECKOUT│   │  approvals, cards│
└──────────────────┘   └──────────────────┘
```

- **Orchestrator**: Drives intent lifecycle (RECEIVED → SEARCHING → QUOTED → AWAITING_APPROVAL → APPROVED → CARD_ISSUED → CHECKOUT_RUNNING → DONE | FAILED | DENIED | EXPIRED). Emits events, enqueues jobs.
- **Policy/Approval**: Approval requests with amount/scope/expiry; on APPROVE, creates simulated pot + ledger entry, then triggers card issuance and checkout job.
- **Payments**: Creates restricted virtual cards via Stripe Issuing (per-authorization limit; optional MCC/domain in scope). One-time card reveal for worker; no full PAN/CVC stored in DB.
- **Monzo simulation**: Pots and ledger in Postgres; on approval we “move” budget into a purchase pot.

## Stack

- **Runtime**: Node.js + TypeScript (ESM)
- **HTTP**: Fastify
- **DB**: PostgreSQL + Prisma
- **Queue**: Redis + BullMQ
- **Payments**: Stripe SDK (Issuing, test mode)
- **Validation**: Zod

## Local dev

### 1. Start Postgres and Redis

```bash
docker compose up -d
```

### 2. Environment

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL, REDIS_URL, WORKER_API_KEY, and optionally Stripe keys.
```

Minimal `.env` for running without Stripe (card issuance will fail until you add keys):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/agent_payments"
REDIS_URL="redis://localhost:6379"
WORKER_API_KEY=your-worker-secret-key-change-me
PORT=3000
```

### 3. DB migrations and seed

```bash
pnpm db:migrate
pnpm db:seed
```

### 4. Run API and worker

Terminal 1 – API:

```bash
pnpm dev
```

Terminal 2 – Stub worker (consumes CHECKOUT jobs, calls card/reveal then agent/result):

```bash
pnpm worker
```

API base: `http://localhost:3000/v1`

## Testing

- **E2E (full harness)** – Starts Docker, runs migrations, starts API, runs Vitest e2e tests, then exits.
  ```bash
  pnpm test:e2e
  ```
  Requires `.env` with `DATABASE_URL`, `REDIS_URL`, `WORKER_API_KEY`. Uses `STRIPE_WEBHOOK_TEST_BYPASS=true` and no Stripe keys (mock cards).

- **Smoke (happy path only)** – Quick check against a running API.
  ```bash
  API_BASE_URL=http://localhost:3000/v1 WORKER_API_KEY=your-key pnpm test:smoke
  ```

- **Manual curl** – See [docs/curl-examples.md](docs/curl-examples.md) for copy-paste commands.

## API overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/intents` | - | Create purchase intent |
| GET | `/v1/intents/:intentId` | - | Get intent + quote, approval, card, jobs, events, result |
| POST | `/v1/intents/:intentId/cancel` | - | Cancel intent if not DONE |
| POST | `/v1/agent/quote` | X-Worker-Key | Worker posts product quote → QUOTED → AWAITING_APPROVAL |
| POST | `/v1/agent/result` | X-Worker-Key | Worker posts DONE/FAILED + summary/artifacts |
| POST | `/v1/intents/:intentId/approval/request` | - | Create approval request (amount, scope, expires_in_seconds) |
| POST | `/v1/approvals/:approvalId/decision` | - | User APPROVE/DENY → pot + card issuance + checkout job |
| POST | `/v1/intents/:intentId/card/issue` | - | Issue card (idempotent; called internally after approval) |
| POST | `/v1/intents/:intentId/card/reveal` | X-Worker-Key | One-time card details for worker |
| POST | `/v1/intents/:intentId/checkout/start` | - | Enqueue CHECKOUT job (internal) |
| POST | `/v1/webhooks/stripe` | Stripe-Signature | Stripe webhooks (Issuing auth/transaction), stored in `stripe_events` |
| GET | `/v1/debug/health` | - | Health (DB) |
| GET | `/v1/debug/queue` | - | Queue counts (waiting/active) |
| GET | `/v1/debug/events?intent_id=...` | - | Audit events (optionally by intent) |

## Curl examples (full flow)

Base URL and worker key (adjust to your `.env`):

```bash
BASE=http://localhost:3000/v1
WORKER_KEY=your-worker-secret-key-change-me
```

### 1. Create intent

```bash
curl -s -X POST "$BASE/intents" \
  -H "Content-Type: application/json" \
  -d '{
    "user_ref": { "type": "telegram", "telegram_user_id": "demo_telegram_123" },
    "text": "Buy latest AirPods Pro",
    "constraints": { "max_budget": 25000, "currency": "USD", "merchant_domain_allowlist": ["apple.com"] }
  }'
# → { "intent_id": "<UUID>", "status": "RECEIVED" }
# Set INTENT_ID=<uuid> for next steps.
```

### 2. Worker posts quote (simulates search result)

```bash
curl -s -X POST "$BASE/agent/quote" \
  -H "Content-Type: application/json" \
  -H "X-Worker-Key: $WORKER_KEY" \
  -d '{
    "intent_id": "'"$INTENT_ID"'",
    "quote": {
      "title": "AirPods Pro (2nd gen)",
      "url": "https://www.apple.com/shop/product/...",
      "amount": 25000,
      "currency": "USD",
      "merchant_domain": "apple.com",
      "mcc_hint": "electronics"
    }
  }'
# → { "ok": true, "next": "AWAITING_APPROVAL" }
```

### 3. Create approval request

```bash
curl -s -X POST "$BASE/intents/$INTENT_ID/approval/request" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 25000,
    "currency": "USD",
    "scope": { "merchant_domain": "apple.com", "mcc_allowlist": ["5732","5942"] },
    "expires_in_seconds": 900
  }'
# → { "approval_id": "<UUID>", "status": "AWAITING_APPROVAL" }
# Set APPROVAL_ID=<uuid>
```

### 4. User approves (triggers card issuance + checkout job)

```bash
curl -s -X POST "$BASE/approvals/$APPROVAL_ID/decision" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "APPROVE",
    "decided_by": { "type": "telegram", "telegram_user_id": "demo_telegram_123" }
  }'
# → { "intent_id": "...", "approval_status": "APPROVED" }
```

(If Stripe Issuing is not configured, card creation will fail here; you can still test the rest with placeholders by mocking or skipping card creation.)

### 5. Inspect intent (card, jobs, events)

```bash
curl -s "$BASE/intents/$INTENT_ID"
```

### 6. Worker gets card (one-time reveal) and posts result

The **stub worker** does this automatically when it picks up the CHECKOUT job: it calls `POST .../card/reveal`, waits 2s, then `POST .../agent/result` with status DONE. To run it:

```bash
pnpm worker
```

Or manually:

```bash
# Card reveal (worker only; one-time)
curl -s -X POST "$BASE/intents/$INTENT_ID/card/reveal" \
  -H "X-Worker-Key: $WORKER_KEY"

# Post result
curl -s -X POST "$BASE/agent/result" \
  -H "Content-Type: application/json" \
  -H "X-Worker-Key: $WORKER_KEY" \
  -d '{
    "intent_id": "'"$INTENT_ID"'",
    "status": "DONE",
    "summary": "Order placed successfully",
    "artifacts": [{ "type": "screenshot", "url": "https://example.com/screen.png" }]
  }'
```

### 7. Debug endpoints

```bash
curl -s "$BASE/debug/health"
curl -s "$BASE/debug/queue"
curl -s "$BASE/debug/events?intent_id=$INTENT_ID"
```

## Database schema (summary)

- **users** – id, telegram_user_id (optional)
- **purchase_intents** – id, user_id, raw_text, status, currency
- **quotes** – intent_id, title, url, amount, merchant_domain, mcc_hint
- **approvals** – intent_id, status, amount, scope_json, expires_at, decided_at
- **pots** – user_id, name, balance_amount (simulated Monzo pots)
- **ledger_entries** – user_id, pot_id, delta_amount, reason
- **cards** – intent_id, stripe_card_id, last4, status, revealed_at, constraints_json (no PAN/CVC stored)
- **jobs** – intent_id, type (SEARCH/CHECKOUT), status, bull_job_id
- **results** – intent_id, status (DONE/FAILED), summary, artifacts_json
- **events** – intent_id, type, payload_json (audit)
- **stripe_events** – stripe_event_id, type, payload_json

## Stripe Issuing (test mode)

1. In Stripe Dashboard enable **Issuing** (test mode).
2. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`.
3. Webhook URL: `https://your-host/v1/webhooks/stripe`; subscribe to `issuing_authorization.*` and `issuing_transaction.*` if you want observability.

Card details (PAN/CVC) are returned only once via `/card/reveal`; we do not persist them. If Stripe does not return the number (e.g. some test setups), the API returns placeholder card details for the stub worker; real issuance and controls are still applied.

## Troubleshooting

- **"Invalid transition"** – Intent is in a state that doesn’t allow the requested action (e.g. posting a quote when not RECEIVED/SEARCHING, or approving when not AWAITING_APPROVAL). Check `GET /v1/intents/:id` for current status.
- **"Missing or invalid X-Worker-Key"** – Use the same value as `WORKER_API_KEY` in `.env` for `/agent/quote`, `/agent/result`, and `/card/reveal`.
- **Card issuance fails** – Ensure Stripe Issuing is enabled and `STRIPE_SECRET_KEY` is set. In test mode, Issuing may have account-specific limits.
- **Worker not processing jobs** – Ensure Redis is running (`docker compose up -d`) and the worker process is running (`pnpm worker`). Check `GET /v1/debug/queue` for job counts.
- **DB connection errors** – Run `docker compose up -d` and confirm `DATABASE_URL` matches the Postgres container (default: `postgresql://postgres:postgres@localhost:5432/agent_payments`).

## Telegram bot

The bot in `apps/telegram-bot` is the user channel: it only calls backend APIs and does not duplicate orchestrator logic.

### Create a bot token

1. In Telegram, open [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, choose name and username.
3. Copy the token (e.g. `123456:ABC-DEF...`).

### Run locally (polling)

1. In project root, ensure API and worker are running (`pnpm dev`, `pnpm worker`).
2. Set env (or create `apps/telegram-bot/.env` from `apps/telegram-bot/.env.example`):
   - `BOT_TOKEN` – from BotFather
   - `API_BASE_URL` – e.g. `http://localhost:3000`
   - `WORKER_API_KEY` – same as backend (bot uses it to post quotes; never exposed to users)
3. Run the bot:
   ```bash
   pnpm bot:dev
   ```

### Webhook (production / ngrok)

1. Run the webhook server (e.g. on port 8080):
   ```bash
   cd apps/telegram-bot && PORT=8080 BOT_TOKEN=... API_BASE_URL=... WORKER_API_KEY=... pnpm run bot:webhook
   ```
2. Expose it (e.g. `ngrok http 8080`) and set the webhook:
   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-host/webhook/LAST_8_CHARS_OF_TOKEN"
   ```
   The app uses path `/webhook/<last 8 chars of token>` by default; set `WEBHOOK_SECRET_PATH` if you prefer another path.

### Bot commands and flow

- **/start** – Welcome and short help.
- **/buy &lt;text&gt;** or free text like “Buy latest AirPods Pro under $250” – Creates intent, replies with “Got it. Searching… (intent: XXX)”.
- **/quote &lt;intentId&gt; &lt;url&gt; &lt;amount&gt; &lt;currency&gt; &lt;merchant_domain&gt;** – Simulates agent quote (amount in dollars, e.g. 250); then shows **Approve** / **Deny** buttons.
- **Approve** – Calls `POST /v1/approvals/:id/decision` APPROVE, then polls intent until DONE/FAILED and replies with result.
- **Deny** – Calls decision DENY and replies “Okay, cancelled.”
- **/status [intentId]** – Shows intent status (uses last intent if no id).

Only the user who created the intent can use the Approve/Deny buttons (callback is validated by Telegram user id).

### Example transcript

```
User: /buy Buy latest AirPods Pro under $250
Bot:  Got it. Searching… (intent: abc-123-uuid)

User: /quote abc-123-uuid https://apple.com/p 250 USD apple.com
Bot:  Approve $250.00 for apple.com? (intent: abc-123-uuid)  [Approve] [Deny]

User: [clicks Approve]
Bot:  Approved. Issuing virtual card + starting checkout…
Bot:  Order placed. (intent: abc-123-uuid) …
```

## Non-goals (this repo)

- No OpenClaw/Playwright worker (stub worker included for flow validation).
- No production hardening (hackathon-focused).

## License

See [LICENSE](LICENSE).
