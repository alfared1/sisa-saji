import { cn } from "@/lib/utils";

/**
 * "Warung uji coba": a real warung in the field pilot (merchants.is_pilot), as opposed
 * to the sample warung of a demo deployment. Paid at the counter.
 */
export function PilotBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-deal-soft px-2 py-1 text-xs leading-none font-semibold text-deal",
        className,
      )}
    >
      Warung uji coba
    </span>
  );
}
