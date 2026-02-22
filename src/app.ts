import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import intentsRoutes from "./routes/intents.js";
import agentRoutes from "./routes/agent.js";
import approvalsRoutes from "./routes/approvals.js";
import cardsRoutes from "./routes/cards.js";
import checkoutRoutes from "./routes/checkout.js";
import webhooksRoutes from "./routes/webhooks.js";
import debugRoutes from "./routes/debug.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  // Preserve raw body for Stripe webhook (must be before body parsing for that route)
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  const prefix = config.API_PREFIX;
  await app.register(intentsRoutes, { prefix });
  await app.register(agentRoutes, { prefix });
  await app.register(approvalsRoutes, { prefix });
  await app.register(cardsRoutes, { prefix });
  await app.register(checkoutRoutes, { prefix });
  await app.register(webhooksRoutes, { prefix });
  await app.register(debugRoutes, { prefix });

  return app;
}
