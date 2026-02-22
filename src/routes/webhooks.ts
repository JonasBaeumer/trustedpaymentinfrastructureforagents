import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";

export default async function webhooksRoutes(app: FastifyInstance) {
  app.post<{ RawBody: Buffer; Body: unknown }>("/webhooks/stripe", {
    config: { rawBody: true },
  }, async (req, reply) => {
    let event: Stripe.Event;

    if (config.STRIPE_WEBHOOK_TEST_BYPASS) {
      const body = req.body as { id?: string; type?: string; data?: { object?: unknown } };
      if (!body?.id || !body?.type) {
        return reply.status(400).send({ error: "Test bypass: body must have id and type" });
      }
      event = {
        id: body.id,
        type: body.type,
        data: body.data ?? { object: {} },
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        object: "event",
        pending_webhooks: 0,
        request: { id: null, idempotency_key: null },
        api_version: "2024-06-20",
      } as Stripe.Event;
    } else {
      const sig = req.headers["stripe-signature"];
      if (!sig || typeof sig !== "string") {
        return reply.status(400).send({ error: "Missing stripe-signature" });
      }
      if (!config.STRIPE_WEBHOOK_SECRET) {
        return reply.status(500).send({ error: "Webhook secret not configured" });
      }
      const rawBody = (req as { rawBody?: Buffer }).rawBody ?? (req.body as Buffer);
      if (!rawBody || !Buffer.isBuffer(rawBody)) {
        return reply.status(400).send({ error: "Raw body required for signature verification" });
      }
      try {
        event = Stripe.webhooks.constructEvent(
          rawBody,
          sig,
          config.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
    }

    await prisma.stripeEvent.upsert({
      where: { stripeEventId: event.id },
      create: {
        stripeEventId: event.id,
        type: event.type,
        payloadJson: JSON.stringify(event.data.object),
      },
      update: {},
    });

    if (event.type === "issuing_authorization.created" || event.type === "issuing_authorization.updated") {
      const auth = event.data.object as Stripe.Issuing.Authorization;
      req.log.info({ authorization: auth.id, amount: auth.amount }, "Stripe Issuing authorization");
    }
    if (event.type === "issuing_transaction.created") {
      const tx = event.data.object as Stripe.Issuing.Transaction;
      req.log.info({ transaction: tx.id, amount: tx.amount }, "Stripe Issuing transaction");
    }

    return reply.send({ received: true });
  });
}
