import { BadgeCheckIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** "Mitra Terverifikasi" (premium / merchant_verified). `compact` = icon + tooltip. */
export function VerifiedBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("inline-flex shrink-0 text-sky-600 dark:text-sky-400", className)}
            aria-label="Mitra Terverifikasi"
            tabIndex={0}
          >
            <BadgeCheckIcon className="size-4" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>Mitra Terverifikasi</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold leading-none text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
        className,
      )}
    >
      <BadgeCheckIcon className="size-3.5" aria-hidden />
      Mitra Terverifikasi
    </span>
  );
}
