/**
 * Ensures `.env` contains strong secrets: `npm run setup:secrets`.
 *
 *   PICKUP_QR_SECRET, SESSION_SECRET, PAYMENT_WEBHOOK_SECRET  32 random bytes, base64url (43 chars)
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (+ VAPID_SUBJECT)      web-push generateVAPIDKeys()
 *
 * Idempotent: existing non-empty values are never overwritten. An empty
 * `KEY=` line is filled in place; missing keys are appended at the end. When
 * `.env` does not exist it is created from `.env.example` first. Only key names
 * are printed, never values.
 *
 * Options: `--file <path>` (or SECRETS_ENV_FILE) targets another file,
 * e.g. for testing without touching the real `.env`.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateVAPIDKeys } from "web-push";

const ROOT = path.resolve(__dirname, "..");
const RANDOM_SECRETS = ["PICKUP_QR_SECRET", "SESSION_SECRET", "PAYMENT_WEBHOOK_SECRET"] as const;
const MIN_SECRET_LENGTH = 32;
const DEFAULT_VAPID_SUBJECT = "mailto:admin@sisasaji.test";

function envFilePath(): string {
  const i = process.argv.indexOf("--file");
  const fromArg = i >= 0 ? process.argv[i + 1] : undefined;
  return path.resolve(ROOT, fromArg ?? process.env.SECRETS_ENV_FILE ?? ".env");
}

/** Value of an uncommented `KEY=value` line (last one wins, like dotenv), or undefined. */
function readValue(lines: string[], key: string): string | undefined {
  let value: string | undefined;
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`);
  for (const line of lines) {
    const m = re.exec(line);
    if (m) value = m[1].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return value;
}

/** Sets KEY on an existing empty `KEY=` line, else appends it. Never touches non-empty values. */
function setValue(lines: string[], key: string, value: string, appended: string[]) {
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*$`);
  const idx = lines.findIndex((l) => re.test(l));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else appended.push(`${key}=${value}`);
}

const randomSecret = () => randomBytes(32).toString("base64url");

function main() {
  const file = envFilePath();
  const example = path.join(ROOT, ".env.example");
  const rel = path.relative(ROOT, file) || file;

  if (!existsSync(file)) {
    if (existsSync(example)) {
      copyFileSync(example, file);
      console.log(`[secrets] ${rel} dibuat dari .env.example`);
    } else {
      writeFileSync(file, "");
      console.log(`[secrets] ${rel} dibuat (kosong)`);
    }
  }

  const original = readFileSync(file, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const added: string[] = [];
  const appended: string[] = [];
  const warnings: string[] = [];

  for (const key of RANDOM_SECRETS) {
    const current = readValue(lines, key);
    if (!current) {
      setValue(lines, key, randomSecret(), appended);
      added.push(key);
    } else if (current.length < MIN_SECRET_LENGTH) {
      warnings.push(`${key} lebih pendek dari ${MIN_SECRET_LENGTH} karakter; produksi akan menolaknya. Kosongkan nilainya lalu jalankan ulang.`);
    }
  }

  const pub = readValue(lines, "VAPID_PUBLIC_KEY");
  const priv = readValue(lines, "VAPID_PRIVATE_KEY");
  if (!pub && !priv) {
    const keys = generateVAPIDKeys();
    setValue(lines, "VAPID_PUBLIC_KEY", keys.publicKey, appended);
    setValue(lines, "VAPID_PRIVATE_KEY", keys.privateKey, appended);
    added.push("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY");
    if (!readValue(lines, "VAPID_SUBJECT")) {
      setValue(lines, "VAPID_SUBJECT", DEFAULT_VAPID_SUBJECT, appended);
      added.push("VAPID_SUBJECT");
    }
  } else if (!pub || !priv) {
    warnings.push("Hanya salah satu kunci VAPID yang terisi. Kosongkan keduanya lalu jalankan ulang untuk membuat pasangan baru.");
  }

  if (added.length) {
    if (appended.length) {
      if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
      lines.push(`# --- dibuat otomatis oleh npm run setup:secrets (${new Date().toISOString().slice(0, 10)}) ---`);
      lines.push(...appended);
    }
    writeFileSync(file, lines.join(eol) + eol);
    console.log(`[secrets] ditambahkan ke ${rel}: ${added.join(", ")}`);
  } else {
    console.log(`[secrets] ${rel} sudah lengkap, tidak ada yang diubah`);
  }
  for (const w of warnings) console.warn(`[secrets] PERINGATAN: ${w}`);
}

main();
