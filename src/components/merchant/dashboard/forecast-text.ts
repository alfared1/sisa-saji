/**
 * Sentences of the "Perkiraan malam ini" card on the warung dashboard. Pure so
 * they can be unit-tested; every line reads as an estimate, never as a fact
 * about past nights (the numbers come from the forecast, not from a count).
 */

/** Confidence score (0–1) in words a warung owner can act on. */
export function confidenceText(score: number): string {
  if (score >= 0.75) return "Perkiraan ini cukup bisa dipegang, polanya mirip beberapa minggu terakhir.";
  if (score >= 0.5) return "Perkiraan kasar dari riwayat beberapa minggu terakhir.";
  return "Masih kasar, riwayat surplus warungmu belum banyak.";
}

/**
 * Chance that tonight's surplus sells out at a 50% discount (0–1), as "n of 10
 * nights like this one", worded as an estimate.
 */
export function selloutText(probability: number): string {
  const p = Number.isFinite(probability) ? probability : 0;
  const outOfTen = Math.min(10, Math.max(0, Math.round(p * 10)));
  if (outOfTen >= 10) return "Dengan diskon 50%, porsi sisa diperkirakan hampir selalu habis.";
  if (outOfTen <= 0) return "Dengan diskon 50%, porsi sisa diperkirakan jarang habis.";
  return `Dengan diskon 50%, porsi sisa diperkirakan habis di sekitar ${outOfTen} dari 10 malam seperti ini.`;
}
