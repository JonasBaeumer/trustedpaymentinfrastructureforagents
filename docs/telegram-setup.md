# Telegram Approval Setup

This guide connects your Telegram account to AgentPay so you receive inline-keyboard approval requests when an agent finds a product to buy.

---

## Prerequisites

- The AgentPay server is running (`npm run dev`)
- You have a Telegram account

---

## Step 1 — Create a Telegram bot

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a display name (e.g. `AgentPay Dev`)
4. Choose a username ending in `bot` (e.g. `agentpay_dev_bot`)
5. BotFather replies with your token: `123456789:ABCdef...` — copy it

---

## Step 2 — Find your Telegram chat ID

1. Open Telegram and start a chat with [@userinfobot](https://t.me/userinfobot)
2. Send any message — it replies with your numeric ID, e.g. `1511820101` — copy it

---

## Step 3 — Configure `.env`

Add the following to your `.env` file (the placeholders are already there):

```
TELEGRAM_BOT_TOKEN=<your bot token from Step 1>
TELEGRAM_WEBHOOK_SECRET=<any random string you choose, e.g. my-secret-123>
TELEGRAM_TEST_CHAT_ID=<your chat ID from Step 2>
```

Restart the server after saving: `Ctrl+C` then `npm run dev`.

---

## Step 4 — Start a conversation with your bot

Open Telegram, search for your bot's username (e.g. `@agentpay_dev_bot`), and send it `/start`. This is required before the bot can send you messages.

---

## Step 5 — Expose your local server with ngrok

Telegram webhooks require a public HTTPS URL. Use ngrok to create one.

**Install ngrok:**
```bash
brew install ngrok
```

**Create a free account** at [dashboard.ngrok.com/signup](https://dashboard.ngrok.com/signup), then add your authtoken:
```bash
ngrok config add-authtoken <your-authtoken>
```

**Start ngrok** (in a separate terminal, keep it running):
```bash
ngrok http 3000
```

Copy the `https://` URL shown, e.g. `https://abc123.ngrok-free.app`.

---

## Step 6 — Register the webhook with Telegram

Run this once (replace both placeholders):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-ngrok-url>/v1/webhooks/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["callback_query"],
    "drop_pending_updates": true
  }'
```

You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

> **Note:** ngrok gives you a new URL each restart (free tier). Re-run this step whenever you restart ngrok.

---

## Step 7 — Link your Telegram account to your user

Find your AgentPay user ID (check the seed output or Prisma Studio), then:

```bash
curl -X POST http://localhost:3000/v1/users/<YOUR_USER_ID>/link-telegram \
  -H "Content-Type: application/json" \
  -d '{"telegramChatId": "<YOUR_CHAT_ID>"}'
```

Expected response:
```json
{"userId":"...","telegramChatId":"...","linked":true}
```

---

## Step 8 — Test it

Create an intent and run the worker:

```bash
# Create an intent
curl -X POST http://localhost:3000/v1/intents \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: test-1" \
  -d '{"userId":"<YOUR_USER_ID>","query":"Sony WH-1000XM5","subject":"Buy Sony headphones","maxBudget":35000}'

# Run the stub worker (posts a quote, triggers the notification)
npm run worker
```

Within a few seconds you should receive a Telegram message like:

> 🛒 **Purchase Approval Request**
>
> **Task:** Buy Sony headphones
> **Merchant:** Amazon UK
> **Price:** 350.00 GBP
> **Budget:** 350.00 GBP
>
> Tap below to decide:
> `[✅ Approve]` `[❌ Reject]`

Tap ✅ Approve — the intent moves to `CHECKOUT_RUNNING` and the message updates to confirm.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No Telegram message arrives | Bot token not loaded | Restart the server after editing `.env` |
| `"chat not found"` error in logs | Never messaged the bot | Send `/start` to your bot in Telegram (Step 4) |
| Buttons do nothing | Webhook not registered or ngrok restarted | Re-run Step 6 with the current ngrok URL |
| `401` on webhook endpoint | Wrong `TELEGRAM_WEBHOOK_SECRET` | Ensure `.env` value matches the `secret_token` in Step 6 |
| ngrok auth error | No authtoken configured | Run `ngrok config add-authtoken <token>` |
