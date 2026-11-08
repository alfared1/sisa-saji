/**
 * `npm run ml:train` — trains the LightGBM Surplus Prediction models and writes
 * lgbm-v1 rows into merchant_surplus_predictions (ml/train_predict.py).
 *
 * Uses the project venv (.venv/Scripts/python.exe on Windows, .venv/bin/python
 * elsewhere) and passes DATABASE_URL (environment first, then .env). Output is
 * streamed; the exit code is the Python script's (non-zero on failure).
 */
import "dotenv/config";
import { runMlTraining } from "../src/server/jobs/ml";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL belum diatur (.env atau environment)");
  const { exitCode, python } = await runMlTraining({ databaseUrl, extraArgs: process.argv.slice(2) });
  if (exitCode !== 0) console.error(`[ml-run] ${python} keluar dengan kode ${exitCode}`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`[ml-run] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
