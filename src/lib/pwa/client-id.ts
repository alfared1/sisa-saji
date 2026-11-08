/**
 * Stable, random per-device id (sent as `client_id` with presence pings so the
 * server can count active devices in a radius without requiring login).
 */
import { readLocal, writeLocal } from "./storage";

const KEY = "ss-client-id";
let cached: string | null = null;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns the device id, creating it on first use. Browser only. */
export function getClientId(): string {
  if (cached) return cached;
  const existing = readLocal(KEY);
  if (existing && existing.length >= 8 && existing.length <= 64) {
    cached = existing;
    return existing;
  }
  const id = `c_${randomHex(16)}`;
  writeLocal(KEY, id);
  cached = id;
  return id;
}
