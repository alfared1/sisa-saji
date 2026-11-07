/**
 * Vitest global setup: an isolated in-memory Postgres + PostGIS (PGlite) on a
 * random local port, migrated and seeded once per test run. Its URL is passed
 * to test workers via `provide("databaseUrl")` (see tests/setup/env.ts).
 */
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { TestProject } from "vitest/node";
import { createDb } from "../../src/db/client";
import { seedDatabase } from "../../src/db/seed";
import { TEST_PICKUP_QR_SECRET } from "./constants";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const pg = await PGlite.create({ dataDir: "memory://", extensions: { postgis } });
  await pg.exec("CREATE EXTENSION IF NOT EXISTS postgis;");
  const server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1", maxConnections: 20 });
  await server.start();
  const conn = server.getServerConn(); // "127.0.0.1:PORT"
  const url = `postgres://postgres:postgres@${conn}/postgres`;

  const { db, pool } = createDb(url, { max: 1 });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedDatabase(db, { pickupQrSecret: TEST_PICKUP_QR_SECRET });
  await pool.end();

  project.provide("databaseUrl", url);

  return async () => {
    await server.stop();
    await pg.close();
  };
}
