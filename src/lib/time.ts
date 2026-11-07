/**
 * Time helpers. All business dates/times are in WIB (Asia/Jakarta, UTC+7, no DST).
 * Client-safe (no Node APIs).
 */
export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
const WIB_OFFSET_MS = 7 * 60 * MINUTE_MS;

/** "YYYY-MM-DD" of `d` in WIB. */
export function wibDate(d: Date = new Date()): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** "HH:MM" of `d` in WIB. */
export function wibTime(d: Date = new Date()): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(11, 16);
}

/** Date for a WIB calendar date + "HH:MM[:SS]". */
export function atWib(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm.slice(0, 5)}:00+07:00`);
}

/** Day of week (0 = Minggu … 6 = Sabtu) of a WIB date string. */
export function wibDayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00+07:00`).getUTCDay();
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * MINUTE_MS);
}

/** Whole minutes from a to b (negative when b is before a). */
export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MINUTE_MS);
}

export const DAY_NAMES_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;

/** "20.30" style clock used in Indonesian UI copy. */
export function formatClockId(iso: string | Date): string {
  return wibTime(typeof iso === "string" ? new Date(iso) : iso).replace(":", ".");
}

/** "Rp 12.500" */
export function formatIdr(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
}
