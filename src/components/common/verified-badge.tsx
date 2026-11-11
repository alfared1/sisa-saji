import { BadgeCheckIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * "Mitra Terverifikasi" (premium / merchant_verified). `compact` = icon + tooltip.
 * `label` overrides the copy, e.g. "Toko Terverifikasi" on the warung header.
 */
export function VerifiedBadge({
  compact = false,
  label = "Mitra Terverifikasi",
  className,
}: {
  compact?: boolean;
  label?: string;
  className?: string;
}) {
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("inline-flex shrink-0 text-brand-strong", className)}
            aria-label={label}
            tabIndex={0}
          >
            <BadgeCheckIcon className="size-4" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 py-1 text-xs font-semibold leading-none text-brand-strong",
        className,
      )}
    >
      <BadgeCheckIcon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
