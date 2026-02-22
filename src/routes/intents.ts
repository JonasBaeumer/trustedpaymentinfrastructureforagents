import type { FastifyInstance } from "fastify";
import { createIntentBodySchema } from "../schemas/intents.js";
import * as orchestrator from "../services/orchestrator.js";

export default async function intentsRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>("/intents", async (req, reply) => {
    const parsed = createIntentBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const { intentId, status } = await orchestrator.createIntent(parsed.data);
    return reply.status(201).send({ intent_id: intentId, status });
  });

  app.get<{ Params: { intentId: string } }>("/intents/:intentId", async (req, reply) => {
    const details = await orchestrator.getIntentDetails(req.params.intentId);
    if (!details) return reply.status(404).send({ error: "Intent not found" });
    const quote = details.quotes[0];
    const approval = details.approvals[0];
    const card = details.cards[0];
    const result = details.results[0];
    return reply.send({
      intent: {
        id: details.id,
        user_id: details.userId,
        raw_text: details.rawText,
        status: details.status,
        currency: details.currency,
        created_at: details.createdAt,
        updated_at: details.updatedAt,
      },
      quote: quote
        ? {
            id: quote.id,
            title: quote.title,
            url: quote.url,
            amount: quote.amount,
            currency: quote.currency,
            merchant_domain: quote.merchantDomain,
            created_at: quote.createdAt,
          }
        : null,
      approval: approval
        ? {
            id: approval.id,
            status: approval.status,
            amount: approval.amount,
            currency: approval.currency,
            expires_at: approval.expiresAt,
            decided_at: approval.decidedAt,
          }
        : null,
      card: card
        ? {
            id: card.id,
            stripe_card_id: card.stripeCardId,
            last4: card.last4,
            status: card.status,
            revealed_at: card.revealedAt,
          }
        : null,
      jobs: details.jobs.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        attempts: j.attempts,
        created_at: j.createdAt,
      })),
      events: details.events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: JSON.parse(e.payloadJson),
        created_at: e.createdAt,
      })),
      result: result
        ? {
            status: result.status,
            summary: result.summary,
            artifacts: JSON.parse(result.artifactsJson),
            created_at: result.createdAt,
          }
        : null,
    });
  });

  app.post<{ Params: { intentId: string } }>("/intents/:intentId/cancel", async (req, reply) => {
    try {
      const { cancelled } = await orchestrator.cancelIntent(req.params.intentId);
      return reply.send({ cancelled });
    } catch (e) {
      if ((e as Error).message === "Intent not found") return reply.status(404).send({ error: "Intent not found" });
      throw e;
    }
  });
}
