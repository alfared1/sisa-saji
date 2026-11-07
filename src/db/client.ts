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
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>["db"];
