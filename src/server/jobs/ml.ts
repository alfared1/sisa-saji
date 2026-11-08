/**
 * Runs the LightGBM pipeline (ml/train_predict.py) with the project's Python venv.
 *
 * Deliberately free of `server-only` / Next imports: used by scripts/ml-run.ts
 * (npm run ml:train) and by the weekly worker job.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const ML_SCRIPT = path.join("ml", "train_predict.py");

/** `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (POSIX), or null when no venv exists. */
export function findVenvPython(root: string = process.cwd()): string | null {
  const candidates = [
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python"),
    path.join(root, ".venv", "bin", "python3"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export interface MlRunOptions {
  /** Project root (default: cwd). */
  root?: string;
  databaseUrl?: string;
  /** Called per output line (default: inherit stdout/stderr). */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  extraArgs?: string[];
}

export interface MlRunResult {
  exitCode: number;
  python: string;
}

/** Spawns the training script and resolves with its exit code (rejects only when Python cannot start). */
export function runMlTraining(opts: MlRunOptions = {}): Promise<MlRunResult> {
  const root = opts.root ?? process.cwd();
  const python = findVenvPython(root);
  if (!python) {
    return Promise.reject(new Error("Python venv tidak ditemukan (.venv). Buat dengan: python -m venv .venv"));
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" };
  if (opts.databaseUrl) env.DATABASE_URL = opts.databaseUrl;

  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(root, ML_SCRIPT), ...(opts.extraArgs ?? [])], {
      cwd: root,
      env,
      stdio: opts.onLine ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    if (opts.onLine) {
      const pipe = (stream: NodeJS.ReadableStream | null, name: "stdout" | "stderr") => {
        if (!stream) return;
        let buf = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
          buf += chunk;
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            opts.onLine!(buf.slice(0, i).replace(/\r$/, ""), name);
            buf = buf.slice(i + 1);
          }
        });
        stream.on("end", () => {
          if (buf) opts.onLine!(buf, name);
        });
      };
      pipe(child.stdout, "stdout");
      pipe(child.stderr, "stderr");
    }
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, python }));
  });
}
