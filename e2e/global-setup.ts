/**
 * Starts the isolated e2e stack and returns the teardown:
 *   1. PGlite + PostGIS on E2E_DB_PORT with a wiped ./.pglite-e2e
 *   2. db-migrate + db-seed (fresh "tonight" batches)
 *   3. `next build` into .next-e2e (skip with E2E_SKIP_BUILD=1 if a build exists)
 *   4. `next start -p E2E_WEB_PORT` (NODE_ENV=production, ALLOW_DEV_SECRETS=true)
 * Uses `node <bin>` instead of npx/shell so it behaves the same on Windows.
 *
 * E2E_SERVER_LOG=<file> appends the database and web server output to that file,
 * which is the only way to see server-side errors behind a failing request.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  E2E_PILOT_CODE,
  E2E_BASE_URL,
  E2E_DATABASE_URL,
  E2E_DB_PORT,
  E2E_DIST_DIR,
  E2E_PGLITE_DIR,
  E2E_WEB_PORT,
} from "./env";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

export const serverEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  DATABASE_URL: E2E_DATABASE_URL,
  NEXT_DIST_DIR: E2E_DIST_DIR,
  ALLOW_DEV_SECRETS: "true",
  OTP_DEV_MODE: "true",
  PAYMENT_PROVIDER: "simulator",
  APP_URL: E2E_BASE_URL,
  NEXT_TELEMETRY_DISABLED: "1",
  // PGlite runs every socket connection through one Postgres session, so concurrent
  // connections interleave statements ("portal does not exist", empty results, foreign
  // statements inside an open transaction). One pooled connection queues them instead.
  DB_POOL_MAX: "1",
  // Field pilot: specs join a warung with this code; the disposable e2e DB may be reseeded over pilot data.
  PILOT_INVITE_CODE: E2E_PILOT_CODE,
  SEED_WIPE_PILOT: "1",
});

function log(msg: string) {
  console.log(`[e2e] ${msg}`);
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function killTree(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function runNode(args: string[], label: string, env: NodeJS.ProcessEnv) {
  log(`${label} …`);
  const res = spawnSync(process.execPath, args, { cwd: ROOT, env, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`[e2e] ${label} failed (exit ${res.status})`);
}

function startProcess(args: string[], env: NodeJS.ProcessEnv, readyText: string | null, label: string) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let output = "";
  const ready = new Promise<void>((resolve, reject) => {
    const logFile = process.env.E2E_SERVER_LOG;
    const onData = (buf: Buffer) => {
      output += buf.toString();
      if (logFile) appendFileSync(logFile, buf.toString().replace(/\r\n/g, "\n").replace(/^(?=.)/gm, `[${label}] `));
      if (output.length > 20_000) output = output.slice(-10_000);
      if (readyText && output.includes(readyText)) resolve();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => reject(new Error(`[e2e] ${label} exited early (code ${code}):\n${output}`)));
    if (!readyText) resolve();
  });
  return { child, ready, output: () => output };
}

async function waitForHealth(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String(err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`[e2e] server not healthy at ${url}: ${last}`);
}

export default async function globalSetup() {
  if (process.env.E2E_EXTERNAL_SERVER === "1") {
    log(`using external server ${E2E_BASE_URL}`);
    return async () => {};
  }
  for (const port of [E2E_DB_PORT, E2E_WEB_PORT]) {
    if (await portInUse(port)) {
      throw new Error(
        `[e2e] port ${port} is already in use. Stop the previous e2e run, or set E2E_EXTERNAL_SERVER=1 to test a running server.`,
      );
    }
  }

  const started: ChildProcess[] = [];
  const teardown = async () => {
    for (const child of started.reverse()) killTree(child);
    log("stopped web server and database");
  };

  try {
    rmSync(path.join(ROOT, E2E_PGLITE_DIR), { recursive: true, force: true });
    log(`starting PGlite on ${E2E_DB_PORT}`);
    const db = startProcess(
      [TSX, "scripts/db-local.ts"],
      { ...process.env, PGLITE_DIR: E2E_PGLITE_DIR, PGLITE_PORT: String(E2E_DB_PORT) },
      "listening",
      "db-local",
    );
    started.push(db.child);
    await db.ready;

    const env = serverEnv();
    runNode([TSX, "scripts/db-migrate.ts"], "migrate", env);
    runNode([TSX, "scripts/db-seed.ts"], "seed", env);

    const hasBuild = existsSync(path.join(ROOT, E2E_DIST_DIR, "BUILD_ID"));
    if (process.env.E2E_SKIP_BUILD === "1" && hasBuild) {
      log(`reusing build in ${E2E_DIST_DIR}`);
    } else {
      runNode([NEXT, "build"], `next build → ${E2E_DIST_DIR}`, { ...env, NODE_ENV: "production" });
    }

    log(`starting next start on ${E2E_WEB_PORT}`);
    const web = startProcess([NEXT, "start", "-p", String(E2E_WEB_PORT)], { ...env, NODE_ENV: "production" }, "Ready", "next start");
    started.push(web.child);
    await web.ready;
    await waitForHealth(`${E2E_BASE_URL}/api/v1/health`, 90_000);
    log("stack ready");
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}
