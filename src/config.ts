import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default("/v1"),
  WORKER_API_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_WEBHOOK_TEST_BYPASS: z.string().optional().transform((v) => v === "true" || v === "1"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid env:", parsed.error.flatten());
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export const config = loadConfig();
