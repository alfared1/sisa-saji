/**
 * Local Postgres + PostGIS without Docker.
 *
 * Runs PGlite (Postgres compiled to WASM) with the PostGIS extension and exposes
 * it over the Postgres wire protocol, so the app, drizzle-kit and the seeder can
 * connect with a normal DATABASE_URL:
 *
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres
 *
 * Data persists in ./.pglite (git-ignored). Delete the folder to reset.
 * Use docker-compose.yml instead when Docker is available.
 */
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.PGLITE_PORT ?? 5433);
const dataDir = process.env.PGLITE_DIR ?? "./.pglite";

async function main() {
  const db = await PGlite.create({ dataDir, extensions: { postgis } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS postgis;");

  const server = new PGLiteSocketServer({
    db,
    port,
    host: "127.0.0.1",
    maxConnections: 20,
  });
  await server.start();

  console.log(`[db-local] PGlite + PostGIS listening on 127.0.0.1:${port} (data: ${dataDir})`);
  console.log(`[db-local] DATABASE_URL=postgres://postgres:postgres@127.0.0.1:${port}/postgres`);

  const shutdown = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[db-local] failed to start:", err);
  process.exit(1);
});
