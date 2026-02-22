import type { FastifyInstance } from "fastify";
import * as payments from "../services/payments.js";
import * as orchestrator from "../services/orchestrator.js";

export default async function cardsRoutes(app: FastifyInstance) {
  app.post<{ Params: { intentId: string } }>("/intents/:intentId/card/issue", async (req, reply) => {
    try {
      const { cardId, stripeCardId, status } = await orchestrator.issueCard(
        req.params.intentId
      );
      return reply.send({
        card_id: cardId,
        stripe_card_id: stripeCardId,
        status,
      });
    } catch (e) {
      if ((e as Error).message === "Intent not found") return reply.status(404).send({ error: "Intent not found" });
      if ((e as Error).message === "No approved approval for intent")
        return reply.status(409).send({ error: (e as Error).message });
      throw e;
    }
  });

  app.post<{ Params: { intentId: string } }>("/intents/:intentId/card/reveal", async (req, reply) => {
    const key = req.headers["x-worker-key"];
    const expected = process.env.WORKER_API_KEY;
    if (!expected || key !== expected) {
      return reply.status(401).send({ error: "Missing or invalid X-Worker-Key" });
    }
    const result = await payments.revealCard(req.params.intentId);
    if (!result) {
      return reply.status(404).send({
        error: "Card not found or already revealed",
      });
    }
    return reply.send({
      card: result.card,
      constraints: result.constraints,
    });
  });
}
