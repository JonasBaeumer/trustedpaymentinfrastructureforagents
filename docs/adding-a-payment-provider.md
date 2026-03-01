# Adding a Payment Provider

This guide explains how to add a new payment provider to the system.

## IPaymentProvider Interface

All payment providers implement `IPaymentProvider` from `src/contracts/services.ts`:

```ts
interface IPaymentProvider {
  issueCard(intentId: string, amount: number, currency: string, options?: { mccAllowlist?: string[] }): Promise<VirtualCardData>;
  revealCard(intentId: string): Promise<CardReveal>;
  freezeCard(intentId: string): Promise<void>;
  cancelCard(intentId: string): Promise<void>;
  handleWebhookEvent(rawBody: Buffer | string, signature: string): Promise<void>;
}
```

### Method Reference

| Method | Purpose |
|--------|---------|
| `issueCard` | Create a virtual card for a purchase intent with spending controls |
| `revealCard` | Return full card credentials (PAN, CVC, expiry) — one-time only |
| `freezeCard` | Temporarily disable the card (reversible) |
| `cancelCard` | Permanently cancel the card |
| `handleWebhookEvent` | Process incoming webhook events (signature verification + routing) |

## Step-by-step

### 1. Create the provider directory

```
src/payments/providers/yourprovider/
  index.ts          # exports YourPaymentProvider class
  <other files>     # internal implementation
```

### 2. Implement IPaymentProvider

```ts
// src/payments/providers/yourprovider/index.ts
import { IPaymentProvider, VirtualCardData, CardReveal } from '@/contracts';

export class YourPaymentProvider implements IPaymentProvider {
  async issueCard(intentId, amount, currency, options?) { /* ... */ }
  async revealCard(intentId) { /* ... */ }
  async freezeCard(intentId) { /* ... */ }
  async cancelCard(intentId) { /* ... */ }
  async handleWebhookEvent(rawBody, signature) { /* ... */ }
}
```

### 3. Register in providerFactory.ts

Add a case in `src/payments/providerFactory.ts`:

```ts
case 'yourprovider': {
  const { YourPaymentProvider } = require('./providers/yourprovider');
  _provider = new YourPaymentProvider();
  break;
}
```

### 4. Set the environment variable

```
PAYMENT_PROVIDER=yourprovider
```

Default is `stripe`. In test environments (`NODE_ENV=test`), the `mock` provider is used automatically.

## Webhook Routing

The Stripe webhook route (`/v1/webhooks/stripe`) passes raw body + signature to `handleWebhookEvent`. If your provider uses webhooks:

- Ensure the raw body is available (Fastify must be configured with a raw body parser for the route)
- Verify the webhook signature inside `handleWebhookEvent` before processing
- Always return without throwing so the HTTP route can respond 200

If your provider uses a different webhook path, add a new route in `src/api/routes/` that calls `getPaymentProvider().handleWebhookEvent(...)`.

## Test Checklist

- [ ] Unit tests: mock external API calls, verify each method's behavior
- [ ] Use `MockPaymentProvider` (set `PAYMENT_PROVIDER=mock` or `NODE_ENV=test`) for testing callers without hitting real APIs
- [ ] Integration tests: verify end-to-end flow with the provider's test/sandbox mode
- [ ] Verify `getPaymentProvider()` returns your provider when `PAYMENT_PROVIDER` env var is set
