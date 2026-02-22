# cURL examples (manual testing)

Set once:

```bash
BASE=http://localhost:3000/v1
WORKER_KEY=your-worker-secret-key-change-me
```

## 1. Create intent

```bash
curl -s -X POST "$BASE/intents" \
  -H "Content-Type: application/json" \
  -d '{
    "user_ref": { "type": "telegram", "telegram_user_id": "demo_123" },
    "text": "Buy latest AirPods Pro",
    "constraints": { "max_budget": 25000, "currency": "USD", "merchant_domain_allowlist": ["apple.com"] }
  }'
# → intent_id, status RECEIVED. Set INTENT_ID=<uuid>
```

## 2. Worker posts quote

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
# → ok: true, next: AWAITING_APPROVAL
```

## 3. Create approval request

```bash
curl -s -X POST "$BASE/intents/$INTENT_ID/approval/request" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 25000,
    "currency": "USD",
    "scope": { "merchant_domain": "apple.com", "mcc_allowlist": ["5732","5942"] },
    "expires_in_seconds": 900
  }'
# → approval_id, status AWAITING_APPROVAL. Set APPROVAL_ID=<uuid>
```

## 4. User approves

```bash
curl -s -X POST "$BASE/approvals/$APPROVAL_ID/decision" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "APPROVE",
    "decided_by": { "type": "telegram", "telegram_user_id": "demo_123" }
  }'
# → intent_id, approval_status: APPROVED
```

## 5. Get intent (poll until CHECKOUT_RUNNING / DONE)

```bash
curl -s "$BASE/intents/$INTENT_ID"
```

## 6. Worker: card reveal (one-time)

```bash
curl -s -X POST "$BASE/intents/$INTENT_ID/card/reveal" \
  -H "X-Worker-Key: $WORKER_KEY"
# → card details + constraints. Second call → 404.
```

## 7. Worker: post result DONE

```bash
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

## 8. Debug

```bash
curl -s "$BASE/debug/health"
curl -s "$BASE/debug/queue"
curl -s "$BASE/debug/events?intent_id=$INTENT_ID"
```

## 9. Deny flow (failure path)

Same as above until step 4; then:

```bash
curl -s -X POST "$BASE/approvals/$APPROVAL_ID/decision" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "DENY",
    "decided_by": { "type": "telegram", "telegram_user_id": "demo_123" }
  }'
# → approval_status: DENIED. Intent status DENIED, no card.
```

## 10. Webhook (test bypass)

With `STRIPE_WEBHOOK_TEST_BYPASS=true`:

```bash
curl -s -X POST "$BASE/webhooks/stripe" \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_manual_1","type":"issuing_authorization.created","data":{"object":{}}}'
# → received: true
```
