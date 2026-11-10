import { SproutIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { impactFigures, impactFiguresFromGrams } from "./impact-text";

/**
 * "🌱 Selamatkan 200 g pangan • −0,5 kg CO₂e" — per-card / per-line impact
 * estimate (dev guide §7), drawn with the Sprout icon used elsewhere. Pass
 * `portionWeightGrams` × `quantity`, or a precomputed `foodGrams` total.
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
    <p className={cn("flex items-start gap-1 text-[11px] leading-snug font-semibold text-emerald-800 dark:text-emerald-300", className)}>
      <SproutIcon className="mt-[0.1em] size-[1.2em] shrink-0" aria-hidden />
      {/*
        Two phrases that wrap as whole units. The "•" sits in each phrase's left
        padding; when the CO₂e phrase starts a new line, that padding lands in
        the clipped negative margin, so a line never begins with a bullet.
      */}
      <span className="min-w-0 overflow-hidden">
        <span className="-ml-3 flex flex-wrap">
          <span className="pl-3">
            Selamatkan <span className="whitespace-nowrap tabular-nums">{f.food}</span> pangan
            <span className="sr-only">,</span>
          </span>
          <span className="relative pl-3 whitespace-nowrap">
            <span className="absolute inset-y-0 left-0 w-3 text-center" aria-hidden>
              •
            </span>
            <span className="tabular-nums">−{f.co2}</span> CO₂e
          </span>
        </span>
      </span>
    </p>
  );
}
