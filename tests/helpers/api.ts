const BASE = process.env.API_BASE_URL ?? "http://localhost:3000/v1";
const WORKER_KEY = process.env.WORKER_API_KEY ?? "test-worker-key";

export const api = {
  base: BASE,
  workerKey: WORKER_KEY,

  async fetch(path: string, opts: RequestInit = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    return fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...opts.headers } });
  },

  async post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return this.fetch(path, { method: "POST", body: JSON.stringify(body), headers });
  },

  async get(path: string): Promise<Response> {
    return this.fetch(path, { method: "GET" });
  },

  async withWorker(path: string, opts: RequestInit = {}): Promise<Response> {
    return this.fetch(path, {
      ...opts,
      headers: { ...opts.headers, "X-Worker-Key": WORKER_KEY },
    });
  },

  async postWithWorker(path: string, body: unknown): Promise<Response> {
    return this.withWorker(path, { method: "POST", body: JSON.stringify(body) });
  },
};

/** Poll GET /v1/intents/:id until status in terminal set or timeout (ms). */
export async function pollIntentUntil(
  intentId: string,
  terminal: string[],
  timeoutMs = 30_000,
  intervalMs = 500
): Promise<{ status: string; body: unknown }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await api.get(`/intents/${intentId}`);
    if (!r.ok) throw new Error(`GET intent failed: ${r.status}`);
    const body = (await r.json()) as { intent?: { status?: string } };
    const status = body.intent?.status ?? body.status;
    if (status && terminal.includes(status)) return { status, body };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const last = await api.get(`/intents/${intentId}`).then((r) => r.json());
  throw new Error(`Timeout waiting for intent ${intentId} to reach ${terminal.join("|")}. Last: ${JSON.stringify(last)}`);
}
