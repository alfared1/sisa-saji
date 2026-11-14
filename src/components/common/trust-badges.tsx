import { PORTION_KENYANG_MIN_PCT } from "@/lib/constants";
import type { TrustSignals } from "@/lib/contracts";
import { hygieneText, portionChipText, portionText } from "@/lib/trust-signals";
import { cn } from "@/lib/utils";

const CHIP =
  "inline-flex shrink-0 items-center rounded-full px-2 py-1 text-xs font-semibold leading-none tabular-nums";

/**
 * Hygiene and portion chips from buyer reviews (TrustSignals; null below the review
 * threshold, so nothing is claimed without data).
 *  - short: "Kebersihan 4,9/5", "Porsi normal 95%" (cards, sheets)
 *  - long: "Kebersihan 4,9/5 dari 42 ulasan", "Porsi normal 95% (kenyang) dari 40 ulasan" (warung page)
 * With `fullPortion` (a batch), the portion chip follows the card rules instead: the warung's
 * "Porsi lebih kecil" disclosure first, then the review share, else "Janji porsi normal".
 * `only="hygiene"` keeps just the hygiene chip where space is tight. Renders nothing when
 * there is nothing to show.
 */
export function TrustBadges({
  trust,
  variant,
  fullPortion,
  only,
  className,
}: {
  trust: TrustSignals;
  variant: "short" | "long";
  fullPortion?: boolean;
  only?: "hygiene" | "portion";
  className?: string;
}) {
  const hygiene = only === "portion" ? null : hygieneText(trust, variant);
  const portion =
    only === "hygiene"
      ? null
      : fullPortion === undefined
        ? portionText(trust, variant)
        : variant === "short"
          ? portionChipText(trust, fullPortion)
          : fullPortion
            ? portionText(trust, "long")
            : "Porsi malam ini lebih kecil dari biasa";
  if (!hygiene && !portion) return null;

  // Green only for a good share measured from reviews; a promise or a disclosure stays neutral.
  const portionGood =
    fullPortion !== false && trust.portion_full !== null && trust.portion_full.pct >= PORTION_KENYANG_MIN_PCT;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Kebersihan dan porsi">
      {hygiene && <li className={cn(CHIP, "bg-brand-soft text-brand-strong")}>{hygiene}</li>}
      {portion && (
        <li className={cn(CHIP, portionGood ? "bg-brand-soft text-brand-strong" : "bg-muted text-foreground/80")}>
          {portion}
        </li>
      )}
    </ul>
  );
}
