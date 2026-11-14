"use client";

import { CEBAN_MAX_PRICE_IDR, QUICK_FILTER_MIN_DISCOUNT_PCT } from "@/lib/constants";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { QuickFilterState } from "../lib/discover-sections";

type Chip = {
  id: string;
  label: string;
  pressed: (s: QuickFilterState) => boolean;
  toggle: (s: QuickFilterState) => QuickFilterState;
};

/** The two distance chips are one choice: pressing one releases the other. */
const CHIPS: readonly Chip[] = [
  {
    id: "near",
    label: "< 500 m",
    pressed: (s) => s.distance === "near",
    toggle: (s) => ({ ...s, distance: s.distance === "near" ? null : "near" }),
  },
  {
    id: "mid",
    label: "< 1 km",
    pressed: (s) => s.distance === "mid",
    toggle: (s) => ({ ...s, distance: s.distance === "mid" ? null : "mid" }),
  },
  {
    id: "cheap",
    label: `Harga ≤ ${formatIdr(CEBAN_MAX_PRICE_IDR)}`,
    pressed: (s) => s.cheap,
    toggle: (s) => ({ ...s, cheap: !s.cheap }),
  },
  {
    id: "discount",
    label: `Diskon ≥ ${QUICK_FILTER_MIN_DISCOUNT_PCT}%`,
    pressed: (s) => s.discount,
    toggle: (s) => ({ ...s, discount: !s.discount }),
  },
];

/**
 * "Filter cepat" chip row on /discover: walking distance, the "ceban" price and a minimum
 * discount. Toggle buttons (aria-pressed), applied on the client to the batches already
 * loaded for the radius (applyQuickFilters). Scrolls sideways on phones, wraps in the
 * desktop rail.
 */
export function QuickFilters({
  value,
  onChange,
  className,
}: {
  value: QuickFilterState;
  onChange: (next: QuickFilterState) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Filter cepat"
      className={cn("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1", className)}
    >
      {CHIPS.map((chip) => {
        const pressed = chip.pressed(value);
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(chip.toggle(value))}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold whitespace-nowrap tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              pressed
                ? "bg-foreground text-background"
                : "bg-muted/70 text-foreground/80 ring-1 ring-border hover:bg-muted",
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
