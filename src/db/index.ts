import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { getDatabaseUrl } from "@/lib/env";
import type { Pool } from "pg";
import { createDb, dbOnPool, SCHEMA_REF, type Db } from "./client";

// One pool per server process, reused across hot reloads in development.
// Created on first use so that importing this module (e.g. during `next build`)
// does not require DATABASE_URL.
const globalForDb = globalThis as unknown as { sisaSajiDb?: Db; sisaSajiPool?: Pool; sisaSajiSchema?: object };

export function getDb(): Db {
  if (!globalForDb.sisaSajiDb || !globalForDb.sisaSajiPool) {
    // Neon: DATABASE_URL is the pooled (-pooler, PgBouncer) string for app traffic.
    // Serverless instances keep their pool small (DB_POOL_MAX).
    const { db, pool } = createDb(getDatabaseUrl(), { max: Number(process.env.DB_POOL_MAX) || 10 });
    // Vercel Fluid compute: keep the instance alive until idle connections are released.
    if (process.env.VERCEL) attachDatabasePool(pool);
    globalForDb.sisaSajiDb = db;
    globalForDb.sisaSajiPool = pool;
    globalForDb.sisaSajiSchema = SCHEMA_REF;
  } else if (globalForDb.sisaSajiSchema !== SCHEMA_REF) {
    // Dev hot reload re-ran schema.ts (e.g. a new column): Drizzle caches column names per
    // client, so rebuild the client on the same pool instead of failing until a restart.
    globalForDb.sisaSajiDb = dbOnPool(globalForDb.sisaSajiPool);
    globalForDb.sisaSajiSchema = SCHEMA_REF;
  }
  return globalForDb.sisaSajiDb;
}

export * as schema from "./schema";
