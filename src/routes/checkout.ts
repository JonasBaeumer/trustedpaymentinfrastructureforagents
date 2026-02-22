import type { FastifyInstance } from "fastify";
import * as orchestrator from "../services/orchestrator.js";

export default async function checkoutRoutes(app: FastifyInstance) {
  app.post<{ Params: { intentId: string } }>("/intents/:intentId/checkout/start", async (req, reply) => {
    try {
      const { jobId, status } = await orchestrator.enqueueCheckout(req.params.intentId);
      return reply.send({ job_id: jobId, status });
    } catch (e) {
      if ((e as Error).message === "Intent not found") return reply.status(404).send({ error: "Intent not found" });
      if ((e as Error).message.includes("Invalid transition"))
        return reply.status(409).send({ error: (e as Error).message });
      throw e;
    }
  });
}
