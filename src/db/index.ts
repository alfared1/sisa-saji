import "server-only";
import { getDatabaseUrl } from "@/lib/env";
import { createDb, type Db } from "./client";

// One pool per server process, reused across hot reloads in development.
// Created on first use so that importing this module (e.g. during `next build`)
// does not require DATABASE_URL.
const globalForDb = globalThis as unknown as { sisaSajiDb?: Db };

export function getDb(): Db {
  // Serverless (Vercel): keep the per-instance pool small and use a pooled DATABASE_URL.
  globalForDb.sisaSajiDb ??= createDb(getDatabaseUrl(), { max: Number(process.env.DB_POOL_MAX) || 10 }).db;
  return globalForDb.sisaSajiDb;
}

export * as schema from "./schema";
