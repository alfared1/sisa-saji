/**
 * Applies SQL migrations in ./drizzle.
 * Uses the DIRECT connection (DATABASE_URL_UNPOOLED, set by Neon) when present:
 * DDL over Neon's PgBouncer pooler (transaction mode) can fail in confusing ways.
 * Falls back to DATABASE_URL (local PGlite / Docker have no pooler).
 */
import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../src/db/client";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  console.log(`[migrate] target: ${new URL(url).host}${process.env.DATABASE_URL_UNPOOLED ? " (direct)" : ""}`);
  const { db, pool } = createDb(url, { max: 1 });
  console.log("[migrate] applying migrations from ./drizzle …");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] done");
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
