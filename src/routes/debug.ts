import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { checkoutQueue, searchQueue } from "../lib/queue.js";

export default async function debugRoutes(app: FastifyInstance) {
  app.get("/debug/health", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return reply.status(503).send({ status: "unhealthy", db: "down" });
    }
    return reply.send({ status: "ok", db: "connected" });
  });

  app.get("/debug/queue", async (_req, reply) => {
    const [checkoutWaiting, checkoutActive, searchWaiting, searchActive] = await Promise.all([
      checkoutQueue.getWaitingCount(),
      checkoutQueue.getActiveCount(),
      searchQueue.getWaitingCount(),
      searchQueue.getActiveCount(),
    ]);
    return reply.send({
      checkout: { waiting: checkoutWaiting, active: checkoutActive },
      search: { waiting: searchWaiting, active: searchActive },
    });
  });

  app.get<{ Querystring: { intent_id?: string } }>("/debug/events", async (req, reply) => {
    const { intent_id } = req.query;
    if (!intent_id) {
      const events = await prisma.event.findMany({
        take: 100,
        orderBy: { createdAt: "desc" },
        include: { intent: { select: { id: true, status: true } } },
      });
      return reply.send({
        events: events.map((e) => ({
          id: e.id,
          intent_id: e.intentId,
          intent_status: e.intent.status,
          type: e.type,
          payload: JSON.parse(e.payloadJson),
          created_at: e.createdAt,
        })),
      });
    }
    const events = await prisma.event.findMany({
      where: { intentId: intent_id },
      orderBy: { createdAt: "asc" },
    });
    return reply.send({
      intent_id,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: JSON.parse(e.payloadJson),
        created_at: e.createdAt,
      })),
    });
  });
}
