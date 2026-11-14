/**
 * Buyer trust signals from reviews: hygiene score and "porsi normal" share. Pure and
 * client-safe; the server builds TrustSignals with toTrustSignals, the UI words them here.
 *
 * Rules: signals come from reviews only, never from the warung's own claim. Each one is null
 * until TRUST_SIGNAL_MIN_REVIEWS reviews answered it, so one review cannot swing it. Counts
 * are reviews ("ulasan"), not distinct buyers. "Porsi normal 100%" only appears when the data
 * says 100%.
 */
import { PORTION_KENYANG_MIN_PCT, TRUST_SIGNAL_MIN_REVIEWS } from "@/lib/constants";
import type { TrustSignals } from "@/lib/contracts";

export const NO_TRUST_SIGNALS: TrustSignals = { hygiene: null, portion_full: null };

type Numeric = number | string | null | undefined;

const num = (v: Numeric): number => (v === null || v === undefined ? 0 : Number(v));
const oneDecimal = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Builds the buyer-facing signals from the merchant aggregates (raw SQL numerics may be strings). */
export function toTrustSignals(row: {
  hygieneAvg: Numeric;
  hygieneCount: Numeric;
  portionFullCount: Numeric;
  portionAnswerCount: Numeric;
}): TrustSignals {
  const hygieneCount = num(row.hygieneCount);
  const answers = num(row.portionAnswerCount);
  const avg = row.hygieneAvg === null || row.hygieneAvg === undefined ? null : Number(row.hygieneAvg);
  return {
    hygiene:
      hygieneCount >= TRUST_SIGNAL_MIN_REVIEWS && avg !== null && Number.isFinite(avg)
        ? { avg: Math.round(avg * 10) / 10, count: hygieneCount }
        : null,
    portion_full:
      answers >= TRUST_SIGNAL_MIN_REVIEWS
        ? { pct: Math.round((Math.min(num(row.portionFullCount), answers) / answers) * 100), count: answers }
        : null,
  };
}

/** "Kebersihan 4,9/5" (short) or "Kebersihan 4,9/5 dari 42 ulasan" (long); null below the threshold. */
export function hygieneText(t: TrustSignals, variant: "short" | "long"): string | null {
  if (!t.hygiene) return null;
  const base = `Kebersihan ${oneDecimal(t.hygiene.avg)}/5`;
  return variant === "short" ? base : `${base} dari ${t.hygiene.count} ulasan`;
}

/**
 * Portion share from reviews; null below the threshold.
 *  - short: "Porsi normal 95%" or "Porsi pas menurut 70% ulasan"
 *  - long:  "Porsi normal 95% (kenyang) dari 40 ulasan" or "Porsi normal menurut 70% dari 40 ulasan"
 */
export function portionText(t: TrustSignals, variant: "short" | "long"): string | null {
  const p = t.portion_full;
  if (!p) return null;
  const kenyang = p.pct >= PORTION_KENYANG_MIN_PCT;
  if (variant === "short") return kenyang ? `Porsi normal ${p.pct}%` : `Porsi pas menurut ${p.pct}% ulasan`;
  return kenyang
    ? `Porsi normal ${p.pct}% (kenyang) dari ${p.count} ulasan`
    : `Porsi normal menurut ${p.pct}% dari ${p.count} ulasan`;
}

/**
 * The portion chip on a batch card or sheet. Tonight's "smaller portion" disclosure wins;
 * then the review share; with too few reviews only the warung's promise ("Janji porsi
 * normal"), which is worded as a commitment, not as a rating.
 */
export function portionChipText(t: TrustSignals, fullPortion: boolean): string {
  if (!fullPortion) return "Porsi lebih kecil";
  return portionText(t, "short") ?? "Janji porsi normal";
}

/**
 * Star rating text: "Belum ada ulasan" without reviews (never a default "5,0 (0)"),
 * otherwise "4,6 (65)" (short) or "4,6 (65 ulasan)" (long).
 */
export function ratingText(avg: number, n: number, variant: "short" | "long" = "short"): string {
  if (!n || n <= 0) return "Belum ada ulasan";
  return variant === "short" ? `${oneDecimal(avg)} (${n})` : `${oneDecimal(avg)} (${n} ulasan)`;
}
