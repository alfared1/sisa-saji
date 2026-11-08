import { cn } from "@/lib/utils";
import { impactFigures, impactFiguresFromGrams } from "./impact-text";

/**
 * "🌱 Selamatkan 200 g pangan • −0,5 kg CO₂e" — per-card / per-line impact
 * estimate (dev guide §7). Pass `portionWeightGrams` × `quantity`, or a
 * precomputed `foodGrams` total.
 */
export function ImpactLine({
  portionWeightGrams,
  quantity = 1,
  foodGrams,
  className,
}: {
  portionWeightGrams?: number | null;
  quantity?: number;
  foodGrams?: number;
  className?: string;
}) {
  const f = foodGrams !== undefined ? impactFiguresFromGrams(foodGrams) : impactFigures(portionWeightGrams, quantity);
  if (f.foodGrams <= 0) return null;
  return (
    <p className={cn("text-[11px] leading-snug font-semibold text-emerald-800 dark:text-emerald-300", className)}>
      {/* Wraps between words, but never inside "200 g" or "−0,5 kg CO₂e". */}
      <span aria-hidden>🌱</span> Selamatkan <span className="whitespace-nowrap tabular-nums">{f.food}</span> pangan{" "}
      <span className="whitespace-nowrap">
        <span aria-hidden>•</span> <span className="tabular-nums">−{f.co2}</span> CO₂e
      </span>
    </p>
  );
}
