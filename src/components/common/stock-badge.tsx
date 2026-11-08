import { FlameIcon, PackageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Low stock threshold that switches the badge to the urgent "Hampir Habis! Sisa 3 porsi" style. */
export const LOW_STOCK_THRESHOLD = 3;

export function StockBadge({
  available,
  unit = "porsi",
  className,
}: {
  available: number;
  unit?: string;
  className?: string;
}) {
  const soldOut = available <= 0;
  const low = !soldOut && available <= LOW_STOCK_THRESHOLD;
  const Icon = low ? FlameIcon : PackageIcon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold tabular-nums leading-none",
        soldOut && "bg-muted text-muted-foreground",
        low && "bg-deal-soft text-deal",
        !soldOut && !low && "bg-muted text-foreground/80",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {soldOut ? "Habis" : low ? `Hampir Habis! Sisa ${available} ${unit}` : `Sisa ${available} ${unit}`}
    </span>
  );
}
