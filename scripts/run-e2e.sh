#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

echo "[e2e] Loading .env..."
if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
  set +a
fi
export WORKER_API_KEY="${WORKER_API_KEY:-test-worker-key}"
export PORT="${E2E_PORT:-3010}"
export API_BASE_URL="http://localhost:${PORT}/v1"
export STRIPE_WEBHOOK_TEST_BYPASS="${STRIPE_WEBHOOK_TEST_BYPASS:-true}"
# Force mock card path (no Stripe) for e2e
unset STRIPE_SECRET_KEY
unset STRIPE_WEBHOOK_SECRET

echo "[e2e] Starting Docker (Postgres + Redis)..."
docker compose up -d
sleep 3

echo "[e2e] Running migrations..."
pnpm prisma migrate deploy
pnpm db:seed 2>/dev/null || true

echo "[e2e] Starting API server on port $PORT..."
pnpm exec tsx src/index.ts &
SERVER_PID=$!
cleanup() {
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "[e2e] Waiting for API health..."
for i in {1..30}; do
  if curl -sf "$API_BASE_URL/debug/health" >/dev/null 2>&1; then
    break
  fi
  if [ $i -eq 30 ]; then
    echo "[e2e] API failed to become healthy"
    exit 1
  fi
  sleep 1
done

echo "[e2e] Running e2e tests..."
API_BASE_URL="$API_BASE_URL" WORKER_API_KEY="$WORKER_API_KEY" STRIPE_WEBHOOK_TEST_BYPASS=true \
  pnpm exec vitest run tests/e2e --reporter=verbose
EXIT=$?

echo "[e2e] Done (exit $EXIT)"
exit $EXIT
