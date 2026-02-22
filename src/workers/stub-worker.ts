import { Job } from "bullmq";
import { createCheckoutWorker, type CheckoutJobData } from "../lib/queue.js";
import { config } from "../config.js";

const BASE = process.env.API_BASE_URL ?? `http://localhost:${config.PORT}${config.API_PREFIX}`;
const WORKER_KEY = config.WORKER_API_KEY;

async function runCheckoutJob(job: Job<CheckoutJobData>): Promise<void> {
  const { intentId } = job.data;
  console.log(`[stub-worker] Processing CHECKOUT for intent ${intentId}`);

  const revealRes = await fetch(`${BASE}/intents/${intentId}/card/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Worker-Key": WORKER_KEY },
  });
  if (!revealRes.ok) {
    const text = await revealRes.text();
    console.warn(`[stub-worker] Card reveal failed: ${revealRes.status} ${text}`);
  } else {
    console.log(`[stub-worker] Card revealed for ${intentId}`);
  }

  await new Promise((r) => setTimeout(r, 2000));

  const resultRes = await fetch(`${BASE}/agent/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Worker-Key": WORKER_KEY },
    body: JSON.stringify({
      intent_id: intentId,
      status: "DONE",
      summary: "Stub worker completed checkout (simulated)",
      artifacts: [{ type: "screenshot", url: "http://example.com/stub-screenshot.png" }],
    }),
  });
  if (!resultRes.ok) {
    const text = await resultRes.text();
    throw new Error(`agent/result failed: ${resultRes.status} ${text}`);
  }
  console.log(`[stub-worker] Result DONE posted for ${intentId}`);
}

async function main() {
  const worker = await createCheckoutWorker(runCheckoutJob);
  console.log("Stub worker started. Consuming CHECKOUT jobs.");
  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
