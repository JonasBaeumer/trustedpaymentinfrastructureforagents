function env(name: string, def?: string): string {
  const v = process.env[name] ?? def;
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const config = {
  BOT_TOKEN: env("BOT_TOKEN"),
  API_BASE_URL: env("API_BASE_URL").replace(/\/$/, ""),
  WORKER_KEY: env("WORKER_API_KEY"),
};
