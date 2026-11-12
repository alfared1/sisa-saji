import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Creates a Drizzle client on node-postgres. Used by the app (src/db/index.ts)
 * and by Node scripts (seed, migrate) that cannot import `server-only`.
 *
 * node-postgres sends Parse/Bind/Execute/Sync in one batch with an unnamed
 * statement, which works with transaction-mode poolers (Neon pooled URLs,
 * PgBouncer) and with the local PGlite socket server (`npm run db:local`).
 */
export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const pool = new Pool({ connectionString: databaseUrl, max: options.max ?? 10 });
  return { db: dbOnPool(pool), pool };
}

/** A Drizzle client on an existing pool (with this module's schema). */
export function dbOnPool(pool: Pool) {
  return drizzle(pool, { schema, casing: "snake_case" });
}

/** The schema module this client was built with (changes when dev hot reload re-runs it). */
export const SCHEMA_REF: object = schema;

export type Db = ReturnType<typeof createDb>["db"];
/** A transaction handle from db.transaction(). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pool-backed db or an open transaction. */
export type DbOrTx = Db | Tx;
