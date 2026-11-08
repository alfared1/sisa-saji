import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DiscountBadge } from "./discount-badge";

/** Strikethrough original + bold selling price + optional discount badge. */
export function PriceTag({
  original,
  selling,
  discountPct,
  size = "md",
  showBadge = true,
  layout = "inline",
  className,
}: {
  original: number;
  selling: number;
  discountPct?: number;
  size?: "sm" | "md" | "lg";
  showBadge?: boolean;
  /** inline: all on one row; stacked: original above selling. */
  layout?: "inline" | "stacked";
  className?: string;
}) {
  const pct =
    discountPct ?? (original > 0 ? Math.max(0, Math.round(((original - selling) / original) * 100)) : 0);
  const hasDiscount = original > selling;

  const sellingCls = cn(
    "font-extrabold tabular-nums text-foreground",
    size === "sm" && "text-sm",
    size === "md" && "text-base",
    size === "lg" && "text-2xl",
  );
  const originalCls = cn(
    "tabular-nums text-muted-foreground line-through decoration-urgent/60",
    size === "lg" ? "text-sm" : "text-xs",
  );

  if (layout === "stacked") {
    return (
      <div className={cn("flex flex-col", className)}>
        {hasDiscount && <span className={originalCls}>{formatIdr(original)}</span>}
        <div className="flex items-center gap-1.5">
          <span className={sellingCls}>{formatIdr(selling)}</span>
          {showBadge && hasDiscount && <DiscountBadge pct={pct} size={size === "lg" ? "md" : "sm"} />}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5", className)}>
      <span className={sellingCls}>{formatIdr(selling)}</span>
      {hasDiscount && <span className={originalCls}>{formatIdr(original)}</span>}
      {showBadge && hasDiscount && (
        <DiscountBadge pct={pct} size={size === "lg" ? "md" : "sm"} className="self-center" />
      )}
    </div>
  );
}
