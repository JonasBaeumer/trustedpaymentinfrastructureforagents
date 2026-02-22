import { Worker, Job } from 'bullmq';
import { getRedisConnectionConfig } from '@/config/redis';
import { SearchIntentJob } from '@/contracts';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const WORKER_KEY = process.env.WORKER_API_KEY || 'local-dev-worker-key';

export function createSearchWorker(): Worker {
  return new Worker(
    'search-queue',
    async (job: Job<SearchIntentJob>) => {
      const { intentId, maxBudget, currency } = job.data;
      console.log(JSON.stringify({ level: 'info', message: 'Processing search job', intentId }));

      // Post a stub quote immediately
      const response = await fetch(`${API_BASE}/v1/agent/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Key': WORKER_KEY,
        },
        body: JSON.stringify({
          intentId,
          merchantName: 'Amazon UK',
          merchantUrl: 'https://amazon.co.uk/stub',
          price: Math.min(maxBudget, maxBudget), // Use the full budget as stub price
          currency,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.log(JSON.stringify({ level: 'warn', message: 'Quote post failed', intentId, status: response.status, body }));
        // Don't throw — intent may already be in AWAITING_APPROVAL or later
        return;
      }

      console.log(JSON.stringify({ level: 'info', message: 'Search job completed — quote posted', intentId }));
    },
    { connection: getRedisConnectionConfig(), concurrency: 5 },
  );
}
