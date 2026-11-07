import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${r("./src")}/$1` },
      // `server-only` throws outside React Server Components; tests run plain Node.
      { find: /^server-only$/, replacement: r("./tests/stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Starts an in-memory PGlite + PostGIS server, migrates and seeds it once.
    globalSetup: ["./tests/setup/global-db.ts"],
    setupFiles: ["./tests/setup/env.ts"],
    // Integration tests share one database: run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
