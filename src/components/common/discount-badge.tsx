"use client";

import { LeafIcon, ZapIcon } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { discountBadgeState, minutesUntil, type DiscountVariant } from "./discount-logic";

export { discountBadgeState, type DiscountVariant } from "./discount-logic";

/** Fill + ring classes per variant (white text; contrast documented in discount-logic.ts). */
export const DISCOUNT_VARIANT_CLASS: Record<DiscountVariant, string> = {
  hemat: "bg-hemat text-white ring-1 ring-hemat-accent/70",
  flash: "bg-flash text-white ring-1 ring-flash-accent",
};

/** Text colour for inline discount labels ("Hemat 50%" written in a line of text). */
export const DISCOUNT_TEXT_CLASS: Record<DiscountVariant, string> = {
  hemat: "text-hemat dark:text-hemat-accent",
  flash: "text-flash dark:text-flash-accent",
};

/**
 * "Hemat 50%" (emerald) or "Flash Rescue 70%" (orange, pulsing under 45 min).
 * Pass `endIso` (pickup_end_time) for a live switch to Flash Rescue as closing
 * time approaches, or `minutesToClose` for a fixed value. Without either, only
 * the ≥ 70 % rule applies. `upTo` prefixes "s/d" (warung-level maximum).
 */
export function DiscountBadge({
  pct,
  endIso,
  minutesToClose,
  upTo = false,
  size = "md",
  className,
}: {
  pct: number;
  endIso?: string | null;
  minutesToClose?: number | null;
  upTo?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  // Twice a minute is plenty for a 45-minute threshold.
  const now = useNow(30_000);
  if (pct <= 0) return null;
  const minutes = minutesToClose !== undefined ? minutesToClose : minutesUntil(endIso, now);
  const s = discountBadgeState(pct, minutes);
  const Icon = s.variant === "flash" ? ZapIcon : LeafIcon;
  const text = upTo ? s.label.replace(/(\d+%)$/, "s/d $1") : s.label;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-extrabold whitespace-nowrap tabular-nums leading-none tracking-tight",
        size === "sm" && "px-1.5 py-1 text-[11px]",
        size === "md" && "px-2 py-1 text-xs",
        size === "lg" && "px-2.5 py-1.5 text-sm",
        DISCOUNT_VARIANT_CLASS[s.variant],
        s.pulse && "animate-flash-pulse",
        className,
      )}
      data-variant={s.variant}
      data-pulse={s.pulse ? "true" : undefined}
    >
      <Icon className={cn("shrink-0", size === "lg" ? "size-3.5" : "size-3")} aria-hidden />
      {text}
    </span>
  );
}
