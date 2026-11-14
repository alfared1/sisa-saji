/**
 * Text for CountdownBadge: "Tutup dalam 01:15:20" (hours, minutes and seconds left).
 * The prefix must say it is a duration ("Tutup dalam", "Ambil dalam", "Bayar dalam"): a
 * bare "Ambil 00:28:12" reads like a clock time ("pick up at 00.28"). Without a prefix the
 * text is just "01:15:20", for places whose label already says what it counts down to.
 */
export function formatCountdownText(
  c: { hours: number; minutes: number; seconds: number },
  prefix: string,
): string {
  const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, "0");
  const body = `${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;
  return prefix ? `${prefix} ${body}` : body;
}
