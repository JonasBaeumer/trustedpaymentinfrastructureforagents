#!/usr/bin/env bash
# Quick smoke: happy path with curl. Requires API running and WORKER_API_KEY set.
set -e
BASE="${API_BASE_URL:-http://localhost:3000/v1}"
WORKER_KEY="${WORKER_API_KEY:?Set WORKER_API_KEY}"
TELEGRAM="smoke_$(date +%s)"

echo "Smoke test -> $BASE"

R=$(curl -s -X POST "$BASE/intents" -H "Content-Type: application/json" \
  -d "{\"user_ref\":{\"type\":\"telegram\",\"telegram_user_id\":\"$TELEGRAM\"},\"text\":\"Buy AirPods Pro\",\"constraints\":{\"max_budget\":25000,\"currency\":\"USD\",\"merchant_domain_allowlist\":[\"apple.com\"]}}")
INTENT_ID=$(echo "$R" | grep -o '"intent_id":"[^"]*"' | cut -d'"' -f4)
echo "  intent_id: $INTENT_ID"

curl -sf -X POST "$BASE/agent/quote" -H "Content-Type: application/json" -H "X-Worker-Key: $WORKER_KEY" \
  -d "{\"intent_id\":\"$INTENT_ID\",\"quote\":{\"title\":\"AirPods Pro\",\"url\":\"https://apple.com/p\",\"amount\":25000,\"currency\":\"USD\",\"merchant_domain\":\"apple.com\"}}" >/dev/null
echo "  quote -> AWAITING_APPROVAL"

R=$(curl -sf -X POST "$BASE/intents/$INTENT_ID/approval/request" -H "Content-Type: application/json" \
  -d '{"amount":25000,"currency":"USD","scope":{"merchant_domain":"apple.com"},"expires_in_seconds":900}')
APPROVAL_ID=$(echo "$R" | grep -o '"approval_id":"[^"]*"' | cut -d'"' -f4)

curl -sf -X POST "$BASE/approvals/$APPROVAL_ID/decision" -H "Content-Type: application/json" \
  -d "{\"decision\":\"APPROVE\",\"decided_by\":{\"type\":\"telegram\",\"telegram_user_id\":\"$TELEGRAM\"}}" >/dev/null
echo "  approved"

curl -sf -X POST "$BASE/intents/$INTENT_ID/card/reveal" -H "X-Worker-Key: $WORKER_KEY" -H "Content-Type: application/json" -d '{}' >/dev/null
echo "  card revealed"

curl -sf -X POST "$BASE/agent/result" -H "Content-Type: application/json" -H "X-Worker-Key: $WORKER_KEY" \
  -d "{\"intent_id\":\"$INTENT_ID\",\"status\":\"DONE\",\"summary\":\"Smoke test order\",\"artifacts\":[]}" >/dev/null
echo "  result DONE"

STATUS=$(curl -sf "$BASE/intents/$INTENT_ID" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  intent status: $STATUS"
[ "$STATUS" = "DONE" ] || exit 1
echo "Smoke OK"
