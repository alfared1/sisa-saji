/**
 * Background worker: `npm run worker` (DATABASE_URL from .env or the environment).
 *
 * Ticks every 30 s and lets the scheduler in src/server/jobs decide what is due:
 * minute jobs (stock expiry, scheduled activation, closing), escalation every
 * ESCALATION_INTERVAL_MINUTES, daily 00:15 / 17:30 WIB jobs and the weekly
 * Sunday 02:00 WIB ML training (only when .venv exists). Each job is caught and
 * logged on its own; SIGINT/SIGTERM finish the running tick, stop ML training and close the pool.
 */
import "dotenv/config";
import { registerHooks } from "node:module";

// The services import the `server-only` marker, which throws outside React Server
// Components. Resolve it with the "react-server" condition (= its empty module).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve(specifier, { ...context, conditions: [...context.conditions, "react-server"] });
    }
    return nextResolve(specifier, context);
  },
});

const TICK_MS = 30_000;

function log(msg: string) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function main() {
  const [{ createDb }, { getDatabaseUrl }, jobs, ml] = await Promise.all([
    import("../src/db/client"),
    import("../src/lib/env"),
    import("../src/server/jobs"),
    import("../src/server/jobs/ml"),
  ]);

  const databaseUrl = getDatabaseUrl();
  const { db, pool } = createDb(databaseUrl, { max: 4 });
  const hasVenv = ml.findVenvPython() !== null;
  const scheduler = jobs.createScheduler({
    db,
    log,
    runMl: hasVenv
      ? async (signal) => {
          const { exitCode } = await ml.runMlTraining({
            databaseUrl,
            signal,
            // train_predict.py already tags its own lines with "[ml]".
            onLine: (line) => log(line.startsWith("[ml]") ? line : `[ml] ${line}`),
          });
          return exitCode;
        }
      : undefined,
  });

  log(`[worker] started (tick ${TICK_MS / 1000} s, db ${new URL(databaseUrl).host}, ML ${hasVenv ? "on" : "off (no .venv)"})`);

  let stopping = false;
  let current: Promise<void> = Promise.resolve();
  const tick = () => {
    if (stopping) return;
    current = scheduler.tick(new Date()).catch((err) => log(`[worker] tick failed: ${String(err)}`));
  };
  tick();
  const timer = setInterval(tick, TICK_MS);

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`[worker] ${signal} received, finishing current tick (ML training is stopped) …`);
    clearInterval(timer);
    await current;
    await scheduler.stop(); // waits for the real in-flight tick and kills/awaits Python
    await pool.end();
    log("[worker] stopped");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log(`[worker] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
