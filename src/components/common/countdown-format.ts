/**
 * Text for CountdownBadge. Always reads as a duration, never as a clock time:
 * "Tutup dalam 1j 05m" (≥ 1 hour) and "Tutup dalam 15m 28d" (< 1 hour) —
 * a bare "Tutup 15:28" looked like "closes at 15:28".
 */
export function formatCountdownText(
  c: { hours: number; minutes: number; seconds: number },
  prefix: string,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const body = c.hours > 0 ? `${c.hours}j ${pad(c.minutes)}m` : `${c.minutes}m ${pad(c.seconds)}d`;
  return prefix ? `${prefix} ${body}` : body;
}
