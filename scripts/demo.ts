/**
 * One-command demo: `npm run demo` (or double-click start-demo.cmd on Windows).
 *
 *   1. ensure strong secrets in .env           (scripts/gen-secrets.ts)
 *   2. start PGlite + PostGIS if nothing listens on the DB port (scripts/db-local.ts)
 *   3. apply migrations                          (scripts/db-migrate.ts)
 *   4. seed fresh demo data, so tonight's batches are live (scripts/db-seed.ts)
 *   5. `next build` when the build is missing or older than the sources
 *   6. `next start` + the worker, with prefixed logs; prints URLs and demo accounts
 *
 * Ctrl+C stops everything. Production mode uses the real secrets from .env
 * (ALLOW_DEV_SECRETS is removed from the environment).
 *
 * `npm run demo:reseed` (= `tsx scripts/demo.ts reseed`) refreshes tonight's data
 * in the demo database while the demo keeps running.
 *
 * Overrides (environment):
 *   DEMO_PORT=3000            web port   (DEMO_* may also be set in the env file)
 *   DEMO_DB_PORT=5433         local PGlite port
 *   DEMO_DB_DIR=./.pglite     PGlite data directory
 *   DEMO_DATABASE_URL=…       use this database instead of the local PGlite
 *   DEMO_ENV_FILE=.env        env file that receives/provides the secrets
 *   DEMO_BUILD=auto           auto | always | never   (flag: --rebuild = always)
 *   DEMO_SEED=true            false = keep the current data   (flag: --no-seed)
 *   NEXT_DIST_DIR=.next       build directory (see next.config.ts)
 *
 * Children are started as `node <entry>` (no shell, no npx) so that Ctrl+C,
 * exit codes and tree-kill behave the same on Windows and POSIX.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { config as loadEnvFile, parse as parseEnv } from "dotenv";

const ROOT = path.resolve(__dirname, "..");
const IS_WIN = process.platform === "win32";
const NODE = process.execPath;
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("-")) ?? "start";

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const COLORS: Record<string, number> = {
  demo: 36, secrets: 35, db: 34, migrate: 34, seed: 34, build: 33, web: 32, worker: 33,
};
function tag(name: string) {
  const label = `[${name}]`.padEnd(10);
  return COLOR ? `\x1b[${COLORS[name] ?? 37}m${label}\x1b[0m` : label;
}
const say = (msg: string) => console.log(`${tag("demo")}${msg}`);
const bold = (s: string) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s);

function fail(msg: string): never {
  console.error(`${tag("demo")}GAGAL: ${msg}`);
  process.exit(1);
}

const ENV_FILE = path.resolve(ROOT, process.env.DEMO_ENV_FILE?.trim() || ".env");
/** DEMO_* settings may also live in the env file; the real environment wins. */
const fileSettings: Record<string, string> = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
function setting(name: string): string | undefined {
  const v = (process.env[name] ?? fileSettings[name])?.trim();
  return v ? v : undefined;
}

function portSetting(name: string, fallback: number): number {
  const raw = setting(name);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) fail(`${name}=${raw} bukan nomor port yang valid.`);
  return n;
}

const PORT = portSetting("DEMO_PORT", 3000);
const DB_PORT = portSetting("DEMO_DB_PORT", 5433);
const DB_DIR = setting("DEMO_DB_DIR") ?? "./.pglite";
const EXTERNAL_DB = setting("DEMO_DATABASE_URL");
const DATABASE_URL = EXTERNAL_DB ?? `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`;
const DIST_DIR = setting("NEXT_DIST_DIR") ?? ".next";
const BUILD_MODE = args.includes("--rebuild") ? "always" : (setting("DEMO_BUILD") ?? "auto");
const SEED = !args.includes("--no-seed") && setting("DEMO_SEED") !== "false";
if (!["auto", "always", "never"].includes(BUILD_MODE)) fail(`DEMO_BUILD=${BUILD_MODE} tidak dikenal (auto | always | never).`);

/* ------------------------------------------------------------------ */
/* Child processes                                                     */
/* ------------------------------------------------------------------ */

interface Child {
  name: string;
  proc: ChildProcess;
  exited: Promise<number>;
  /** Long-running service: an unexpected exit stops the whole demo. */
  service: boolean;
}

const children = new Set<Child>();
let stopping = false;

/*
 * PID file for stop-demo.cmd (scripts/stop-demo.ps1): lists this demo process and
 * its children, so the stop script ends exactly this demo and never another
 * `next dev` or worker that happens to run from the same folder. One file per
 * web port, under node_modules/.cache (always git-ignored); removed on exit.
 */
const PID_DIR = path.join(ROOT, "node_modules", ".cache", "sisa-saji");
let pidFile: string | undefined;
function writePidFile() {
  if (!pidFile) return;
  try {
    mkdirSync(PID_DIR, { recursive: true });
    const data = {
      demoPid: process.pid,
      port: PORT,
      startedAt: new Date().toISOString(),
      children: [...children].filter((c) => c.proc.pid !== undefined).map((c) => ({ name: c.name, pid: c.proc.pid })),
    };
    writeFileSync(pidFile, JSON.stringify(data, null, 2));
  } catch {
    // Best effort: stop-demo falls back to matching command lines.
  }
}
function removePidFile() {
  if (!pidFile) return;
  try {
    rmSync(pidFile, { force: true });
  } catch {
    // ignore
  }
}

// Also on fail() / process.exit paths, so a stale file never points at dead PIDs.
process.on("exit", removePidFile);

function pipeLines(stream: NodeJS.ReadableStream | null, name: string, onLine?: (line: string) => void) {
  if (!stream) return;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const ownPrefix = `[${name}] `;
  rl.on("line", (line) => {
    // Child scripts that already prefix their output (gen-secrets) are not tagged twice.
    console.log(`${tag(name)}${line.startsWith(ownPrefix) ? line.slice(ownPrefix.length) : line}`);
    onLine?.(line);
  });
}

function run(
  name: string,
  argv: string[],
  opts: { env?: NodeJS.ProcessEnv; service?: boolean; onLine?: (line: string) => void } = {},
): Child {
  const proc = spawn(NODE, argv, {
    cwd: ROOT,
    env: opts.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  pipeLines(proc.stdout, name, opts.onLine);
  pipeLines(proc.stderr, name, opts.onLine);
  const exited = new Promise<number>((resolve) => {
    proc.on("error", (err) => {
      console.error(`${tag(name)}tidak bisa dijalankan: ${err.message}`);
      resolve(1);
    });
    proc.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  const child: Child = { name, proc, exited, service: opts.service ?? false };
  children.add(child);
  writePidFile();
  void exited.then((code) => {
    children.delete(child);
    if (!stopping) writePidFile();
    if (child.service && !stopping) {
      say(`proses "${name}" berhenti tak terduga (kode ${code}); menghentikan demo …`);
      void shutdown(1);
    }
  });
  return child;
}

/** Runs a TypeScript script with tsx in-process (`node --import tsx`). */
const tsx = (script: string, ...rest: string[]) => ["--import", "tsx", path.join(ROOT, script), ...rest];

async function step(name: string, argv: string[], env?: NodeJS.ProcessEnv) {
  const code = await run(name, argv, { env }).exited;
  if (stopping) return;
  if (code !== 0) {
    say(`langkah "${name}" gagal (kode ${code}).`);
    await shutdown(1);
  }
}

/** Kills a process tree without waiting (Windows: taskkill /T /F; POSIX: SIGKILL). */
function forceKill(child: Child) {
  const pid = child.proc.pid;
  if (pid === undefined || child.proc.exitCode !== null) return;
  if (IS_WIN) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else child.proc.kill("SIGKILL");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function stopGroup(group: Child[], graceMs: number) {
  if (!group.length) return;
  // POSIX: forward SIGINT. Windows: a console Ctrl+C already reached every child
  // (they share the console); other signals cannot be forwarded gracefully there.
  if (!IS_WIN) for (const c of group) c.proc.kill("SIGINT");
  const timeout = sleep(graceMs).then(() => "timeout" as const);
  await Promise.race([Promise.all(group.map((c) => c.exited)), timeout]);
  for (const c of group) forceKill(c);
  await Promise.all(group.map((c) => c.exited));
}

let shutdownPromise: Promise<never> | undefined;
function shutdown(code: number, graceful = false): Promise<never> {
  shutdownPromise ??= (async () => {
    stopping = true;
    say("menghentikan semua proses …");
    // Graceful (console Ctrl+C on Windows, any signal on POSIX): give the app and
    // the worker time to finish, then stop the database last.
    const grace = graceful || !IS_WIN ? 10_000 : 1_500;
    const all = [...children];
    await stopGroup(all.filter((c) => c.name !== "db"), grace);
    await stopGroup(all.filter((c) => c.name === "db"), grace);
    removePidFile();
    say(code === 0 ? "selesai. Sampai jumpa!" : "demo berhenti.");
    process.exit(code);
  })();
  return shutdownPromise;
}

process.on("SIGINT", () => void shutdown(0, true));
process.on("SIGTERM", () => void shutdown(0, true));
process.on("SIGHUP", () => void shutdown(0, true)); // console window closed (Windows)
if (IS_WIN) process.on("SIGBREAK", () => void shutdown(0, true));
process.on("uncaughtException", (err) => {
  console.error(`${tag("demo")}error: ${err.stack ?? err.message}`);
  void shutdown(1);
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** True when something accepts TCP connections on host:port. */
function isListening(port: number, host = "127.0.0.1", timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** True when we could bind the port ourselves (nothing else is using it). */
function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port }, () => server.close(() => resolve(true)));
  });
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) return false;
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function newestMtime(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    newest = Math.max(newest, newestMtime(path.join(p, entry.name)));
  }
  return newest;
}

/** Why a build is needed, or null when the existing build is up to date. */
function buildReason(): string | null {
  if (BUILD_MODE === "always") return "diminta (--rebuild / DEMO_BUILD=always)";
  const buildId = path.join(ROOT, DIST_DIR, "BUILD_ID");
  if (!existsSync(buildId)) {
    return BUILD_MODE === "never" ? null : `belum ada build di ${DIST_DIR}`;
  }
  if (BUILD_MODE === "never") return null;
  const builtAt = statSync(buildId).mtimeMs;
  const inputs = [
    "src", "public", "next.config.ts", "package.json", "package-lock.json", "tsconfig.json",
    "postcss.config.mjs", ".env", ".env.local", ".env.production", ".env.production.local",
  ];
  for (const input of inputs) {
    if (newestMtime(path.join(ROOT, input)) > builtAt) return `${input} berubah setelah build terakhir`;
  }
  return null;
}

function lanAddress(): string | undefined {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return undefined;
}

/** Loads the env file (never overriding the real environment) and checks the secrets. */
function prepareEnvironment() {
  loadEnvFile({ path: ENV_FILE, quiet: true });
  for (const key of ["PICKUP_QR_SECRET", "SESSION_SECRET", "PAYMENT_WEBHOOK_SECRET"]) {
    const v = process.env[key]?.trim() ?? "";
    if (v.length < 32) fail(`${key} belum diisi (min. 32 karakter). Jalankan: npm run setup:secrets`);
  }
  // Production mode with the real secrets only.
  delete process.env.ALLOW_DEV_SECRETS;
  // The demo relies on on-screen OTP codes and the payment simulator.
  process.env.OTP_DEV_MODE ??= "true";
  process.env.PAYMENT_PROVIDER ??= "simulator";
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.APP_URL = process.env.DEMO_APP_URL?.trim() || `http://localhost:${PORT}`;
  process.env.NEXT_TELEMETRY_DISABLED ??= "1";
}

const redactedDbUrl = () => {
  const u = new URL(DATABASE_URL);
  return `${u.hostname}:${u.port || 5432}${u.pathname}`;
};

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

async function ensureDatabase() {
  if (EXTERNAL_DB) {
    say(`memakai DEMO_DATABASE_URL (${redactedDbUrl()})`);
    return;
  }
  if (await isListening(DB_PORT)) {
    say(`database sudah berjalan di 127.0.0.1:${DB_PORT}, dipakai ulang`);
    return;
  }
  say(`menyalakan PGlite + PostGIS di 127.0.0.1:${DB_PORT} (data: ${DB_DIR}) …`);
  let ready = false;
  const db = run("db", tsx("scripts/db-local.ts"), {
    service: true,
    env: { ...process.env, PGLITE_PORT: String(DB_PORT), PGLITE_DIR: DB_DIR },
    onLine: (line) => {
      if (line.includes("listening")) ready = true;
    },
  });
  const ok = await waitFor(async () => ready || db.proc.exitCode !== null, 120_000, 250);
  if (stopping) return;
  if (!ok || !ready) {
    say(`database tidak siap. Jika port ${DB_PORT} dipakai program lain, set DEMO_DB_PORT.`);
    await shutdown(1);
  }
}

async function start() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) fail(`butuh Node.js 22 atau lebih baru (terpasang: ${process.versions.node}).`);
  if (!existsSync(NEXT_BIN)) fail("node_modules belum lengkap. Jalankan: npm install");

  console.log(bold("\n  Sisa-Saji — mode demo (produksi)\n"));

  // 1. Secrets
  await step("secrets", tsx("scripts/gen-secrets.ts", "--file", ENV_FILE));
  prepareEnvironment();

  // Fail fast when the web port is taken (before spending time on DB/build).
  if ((await isListening(PORT)) || !(await canBind(PORT))) {
    fail(
      `port ${PORT} sudah dipakai program lain. Tutup demo/server yang masih jalan ` +
        `(stop-demo.cmd) atau pilih port lain, mis. DEMO_PORT=3001 npm run demo`,
    );
  }

  // PID file from here on (stop-demo.cmd reads it); removed again on shutdown.
  pidFile = path.join(PID_DIR, `demo-${PORT}.json`);
  writePidFile();

  // 2–4. Database, migrations, demo data
  await ensureDatabase();
  await step("migrate", tsx("scripts/db-migrate.ts"));
  if (SEED) await step("seed", tsx("scripts/db-seed.ts"));
  else say("seed dilewati (DEMO_SEED=false / --no-seed)");

  // 5. Build
  const reason = buildReason();
  if (reason) {
    say(`next build: ${reason} (±1–3 menit) …`);
    await step("build", [NEXT_BIN, "build"], { ...process.env, NODE_ENV: "production" });
  } else {
    say(`build ${DIST_DIR} masih terbaru, dilewati (paksa dengan --rebuild)`);
  }
  if (stopping) return;

  // 6. Web + worker
  run("web", [NEXT_BIN, "start", "-p", String(PORT)], {
    service: true,
    env: { ...process.env, NODE_ENV: "production" },
  });
  run("worker", tsx("scripts/worker.ts"), { service: true, env: { ...process.env, NODE_ENV: "production" } });

  const healthUrl = `http://127.0.0.1:${PORT}/api/v1/health`;
  const healthy = await waitFor(async () => {
    try {
      const res = await fetch(healthUrl);
      return res.ok;
    } catch {
      return false;
    }
  }, 120_000, 1_000);
  if (stopping) return;
  if (!healthy) {
    say(`aplikasi tidak menjawab ${healthUrl} dalam 2 menit.`);
    await shutdown(1);
    return;
  }

  const base = `http://localhost:${PORT}`;
  const lan = lanAddress();
  const lines = [
    "",
    bold("  Sisa-Saji siap!"),
    "",
    `  Pembeli     ${base}/welcome`,
    `  Mitra       ${base}/merchant/dashboard`,
    `  Health      ${base}/api/v1/health`,
    ...(lan ? [`  Jaringan    http://${lan}:${PORT}  (lihat README: login dari HP butuh HTTPS)`] : []),
    "",
    "  Akun demo (kode OTP tampil di layar /auth/verify):",
    "    Pembeli   demo.pembeli@sisasaji.test  /  +6281200000001",
    "    Mitra     demo.mitra@sisasaji.test    /  +6281300000001",
    "",
    `  Database    ${redactedDbUrl()}${EXTERNAL_DB ? "" : ` (PGlite, data: ${DB_DIR})`}`,
    "  Data malam ini kedaluwarsa ±2,5 jam setelah seed → npm run demo:reseed",
    "  Hentikan dengan Ctrl+C.",
    "",
  ];
  for (const l of lines) console.log(`${tag("demo")}${l}`);
}

async function reseed() {
  prepareEnvironment();
  if (!EXTERNAL_DB && !(await isListening(DB_PORT))) {
    fail(`tidak ada database di 127.0.0.1:${DB_PORT}. Jalankan dulu: npm run demo`);
  }
  say(`seed ulang data demo di ${redactedDbUrl()} …`);
  await step("seed", tsx("scripts/db-seed.ts"));
  say("selesai. Batch malam ini segar lagi; login ulang di browser karena akun demo dibuat ulang.");
  process.exit(0);
}

const commands: Record<string, () => Promise<void>> = { start, reseed };
const handler = commands[command];
if (!handler) fail(`perintah tidak dikenal: ${command} (pakai: start | reseed)`);
handler().catch((err: unknown) => {
  console.error(`${tag("demo")}error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  void shutdown(1);
});
