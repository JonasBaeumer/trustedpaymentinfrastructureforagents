import type { FastifyInstance } from "fastify";
import { agentQuoteBodySchema } from "../schemas/quotes.js";
import { agentResultBodySchema } from "../schemas/agent-result.js";
import * as orchestrator from "../services/orchestrator.js";

export default async function agentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    const key = req.headers["x-worker-key"];
    const expected = process.env.WORKER_API_KEY;
    if (!expected || key !== expected) {
      return reply.status(401).send({ error: "Missing or invalid X-Worker-Key" });
    }
  });

  app.post<{ Body: unknown }>("/agent/quote", async (req, reply) => {
    const parsed = agentQuoteBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const { intent_id, quote } = parsed.data;
    try {
      const { next } = await orchestrator.acceptQuote(intent_id, quote);
      return reply.send({ ok: true, next });
    } catch (e) {
      if ((e as Error).message === "Intent not found") return reply.status(404).send({ error: "Intent not found" });
      if ((e as Error).message.includes("Invalid transition"))
        return reply.status(409).send({ error: (e as Error).message });
      throw e;
    }
  });

  app.post<{ Body: unknown }>("/agent/result", async (req, reply) => {
    const parsed = agentResultBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const { intent_id, status, summary, artifacts } = parsed.data;
    try {
      await orchestrator.recordResult(intent_id, status, summary, artifacts);
      return reply.send({ ok: true });
    } catch (e) {
      if ((e as Error).message === "Intent not found") return reply.status(404).send({ error: "Intent not found" });
      if ((e as Error).message.includes("Invalid transition"))
        return reply.status(409).send({ error: (e as Error).message });
      throw e;
    }
  });
}
