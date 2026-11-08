import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";

/** "Rp 12.500" with tabular figures. */
export function Money({
  value,
  className,
  prefix,
}: {
  value: number;
  className?: string;
  /** e.g. "-" for discounts, "+" for credits. */
  prefix?: string;
}) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {prefix}
      {formatIdr(value)}
    </span>
  );
}
