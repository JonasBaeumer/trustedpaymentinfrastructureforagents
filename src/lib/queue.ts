import { Queue, Worker, Job } from "bullmq";
import { config } from "../config.js";

const connection = { url: config.REDIS_URL };

export const CHECKOUT_QUEUE_NAME = "checkout_intent";
export const SEARCH_QUEUE_NAME = "search_intent";

export const checkoutQueue = new Queue(CHECKOUT_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 100 },
  },
});

export const searchQueue = new Queue(SEARCH_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { count: 100 },
  },
});

export function getQueueConnection() {
  return connection;
}

export type CheckoutJobData = { intentId: string };
export type SearchJobData = { intentId: string };

export function createCheckoutWorker(
  processor: (job: Job<CheckoutJobData>) => Promise<void>
): Worker<CheckoutJobData> {
  return new Worker<CheckoutJobData>(
    CHECKOUT_QUEUE_NAME,
    processor,
    { connection, concurrency: 2 }
  );
}

export function createSearchWorker(
  processor: (job: Job<SearchJobData>) => Promise<void>
): Worker<SearchJobData> {
  return new Worker<SearchJobData>(
    SEARCH_QUEUE_NAME,
    processor,
    { connection, concurrency: 2 }
  );
}
