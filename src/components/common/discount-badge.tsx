import { cn } from "@/lib/utils";

export type DiscountTone = "mild" | "deal" | "hot";

/** Colour escalates with the discount: <40 % green, 40–59 % orange, ≥60 % red. */
export function discountTone(pct: number): DiscountTone {
  if (pct >= 60) return "hot";
  if (pct >= 40) return "deal";
  return "mild";
}

const TONE_CLASS: Record<DiscountTone, string> = {
  mild: "bg-primary text-primary-foreground",
  deal: "bg-deal text-deal-foreground",
  hot: "bg-urgent text-urgent-foreground",
};

export function DiscountBadge({
  pct,
  size = "md",
  className,
}: {
  pct: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (pct <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-extrabold tabular-nums leading-none tracking-tight",
        size === "sm" && "px-1.5 py-1 text-[11px]",
        size === "md" && "px-2 py-1 text-xs",
        size === "lg" && "px-2.5 py-1.5 text-sm",
        TONE_CLASS[discountTone(pct)],
        className,
      )}
      aria-label={`Diskon ${pct} persen`}
    >
      -{Math.round(pct)}%
    </span>
  );
}
