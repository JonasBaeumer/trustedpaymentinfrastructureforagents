// TODO: move cardService.ts and webhookHandler.ts into this directory (providers/stripe/)
// so all Stripe implementation lives here. Currently they remain at src/payments/ root
// for a safe incremental migration — this shim keeps callers decoupled in the meantime.
import { IPaymentProvider, VirtualCardData, CardReveal } from '@/contracts';
import { issueVirtualCard, revealCard, freezeCard, cancelCard } from '@/payments/cardService';
import { handleStripeEvent } from '@/payments/webhookHandler';

export class StripePaymentProvider implements IPaymentProvider {
  async issueCard(
    intentId: string,
    amount: number,
    currency: string,
    options?: { mccAllowlist?: string[] },
  ): Promise<VirtualCardData> {
    return issueVirtualCard(intentId, amount, currency, options);
  }

  async revealCard(intentId: string): Promise<CardReveal> {
    return revealCard(intentId);
  }

  async freezeCard(intentId: string): Promise<void> {
    return freezeCard(intentId);
  }

  async cancelCard(intentId: string): Promise<void> {
    return cancelCard(intentId);
  }

  async handleWebhookEvent(rawBody: Buffer | string, signature: string): Promise<void> {
    return handleStripeEvent(rawBody, signature);
  }
}
