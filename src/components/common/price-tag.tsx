import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DiscountBadge } from "./discount-badge";

/**
 * Selling price in orange (deal) + grey strikethrough original + optional discount badge. `plate`
 * adds the orange plate line from the logo under the price (menu cards, order sheet).
 */
export function PriceTag({
  original,
  selling,
  discountPct,
  endIso,
  size = "md",
  showBadge = true,
  layout = "inline",
  plate = false,
  className,
}: {
  original: number;
  selling: number;
  discountPct?: number;
  /** pickup_end_time — lets the badge switch to "Diskon Kilat" (pulsing) under 45 min. */
  endIso?: string | null;
  size?: "sm" | "md" | "lg";
  showBadge?: boolean;
  /** inline: all on one row; stacked: original above selling. */
  layout?: "inline" | "stacked";
  /** Orange plate line under the price: 36×4 px, or 28×3 px for size "sm". */
  plate?: boolean;
  className?: string;
}) {
  const pct =
    discountPct ?? (original > 0 ? Math.max(0, Math.round(((original - selling) / original) * 100)) : 0);
  const hasDiscount = original > selling;

  const sellingCls = cn(
    "font-extrabold tabular-nums text-deal",
    size === "sm" && "text-sm",
    size === "md" && "text-base",
    size === "lg" && "text-2xl",
  );
  const originalCls = cn(
    "tabular-nums text-muted-foreground line-through",
    size === "lg" ? "text-sm" : "text-xs",
  );

  const plateLine = plate ? (
    <span aria-hidden className={cn("block rounded-full bg-plate", size === "sm" ? "mt-1 h-[3px] w-7" : "mt-1.5 h-1 w-9")} />
  ) : null;

  if (layout === "stacked") {
    return (
      <div className={cn("flex flex-col", className)}>
        {hasDiscount && <span className={originalCls}>{formatIdr(original)}</span>}
        <div className="flex items-center gap-1.5">
          <span className={sellingCls}>{formatIdr(selling)}</span>
          {showBadge && hasDiscount && <DiscountBadge pct={pct} endIso={endIso} size={size === "lg" ? "md" : "sm"} />}
        </div>
        {plateLine}
      </div>
    );
  }

  const row = (
    <div className={cn("flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5", !plate && className)}>
      <span className={sellingCls}>{formatIdr(selling)}</span>
      {hasDiscount && <span className={originalCls}>{formatIdr(original)}</span>}
      {showBadge && hasDiscount && (
        <DiscountBadge pct={pct} endIso={endIso} size={size === "lg" ? "md" : "sm"} className="self-center" />
      )}
    </div>
  );
  if (!plate) return row;
  return (
    <div className={className}>
      {row}
      {plateLine}
    </div>
  );
}
