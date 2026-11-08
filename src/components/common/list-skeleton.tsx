import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Loading placeholders: `card` (menu/merchant cards), `row` (list rows), `tile` (carousel). */
export function ListSkeleton({
  count = 3,
  variant = "card",
  className,
}: {
  count?: number;
  variant?: "card" | "row" | "tile";
  className?: string;
}) {
  const items = Array.from({ length: count }, (_, i) => i);

  if (variant === "tile") {
    return (
      <div className={cn("flex gap-3 overflow-hidden", className)} aria-busy="true" aria-label="Memuat">
        {items.map((i) => (
          <div key={i} className="w-40 shrink-0 space-y-2">
            <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "row") {
    return (
      <div className={cn("divide-y divide-border", className)} aria-busy="true" aria-label="Memuat">
        {items.map((i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Memuat">
      {items.map((i) => (
        <div key={i} className="flex gap-3 rounded-3xl bg-card p-3 ring-1 ring-border">
          <Skeleton className="size-24 shrink-0 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="mt-auto flex gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
