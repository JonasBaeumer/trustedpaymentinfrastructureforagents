import { defineConfig } from "vitest/config";
import type { UserConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 35_000,
    hookTimeout: 15_000,
    include: ["tests/**/*.test.ts"],
    env: {
      STRIPE_WEBHOOK_TEST_BYPASS: "true",
    },
  },
}) as UserConfig;
