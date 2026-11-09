import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { getDatabaseUrl } from "@/lib/env";
import { createDb, type Db } from "./client";

// One pool per server process, reused across hot reloads in development.
// Created on first use so that importing this module (e.g. during `next build`)
// does not require DATABASE_URL.
const globalForDb = globalThis as unknown as { sisaSajiDb?: Db };

export function getDb(): Db {
  if (!globalForDb.sisaSajiDb) {
    // Neon: DATABASE_URL is the pooled (-pooler, PgBouncer) string for app traffic.
    // Serverless instances keep their pool small (DB_POOL_MAX).
    const { db, pool } = createDb(getDatabaseUrl(), { max: Number(process.env.DB_POOL_MAX) || 10 });
    // Vercel Fluid compute: keep the instance alive until idle connections are released.
    if (process.env.VERCEL) attachDatabasePool(pool);
    globalForDb.sisaSajiDb = db;
  }
  return globalForDb.sisaSajiDb;
}

export * as schema from "./schema";
