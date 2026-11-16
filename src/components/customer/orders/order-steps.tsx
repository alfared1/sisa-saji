import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ONLINE_STEPS = ["Kunci porsi", "Bayar", "Ambil", "Selesai"] as const;
/** Cash tickets pay at the counter when they collect, so paying and collecting are one step. */
const CASH_STEPS = ["Kunci porsi", "Bayar & ambil", "Selesai"] as const;

export type OrderStepKey = "pay" | "collect" | "done";

/**
 * Where the buyer is in the order: Kunci porsi · Bayar · Ambil · Selesai (cash: Kunci porsi ·
 * Bayar & ambil · Selesai). Done steps get a check, the current one a thick ring and aria-current.
 */
export function OrderSteps({ at, cash = false, className }: { at: OrderStepKey; cash?: boolean; className?: string }) {
  const steps = cash ? CASH_STEPS : ONLINE_STEPS;
  const current = cash ? { pay: 1, collect: 1, done: 2 }[at] : { pay: 1, collect: 2, done: 3 }[at];
  return (
    <ol aria-label="Tahap pesanan" className={cn("grid gap-1", cash ? "grid-cols-3" : "grid-cols-4", className)}>
      {steps.map((label, i) => {
        // The last step is reached, not worked on: show it done.
        const done = i < current || (at === "done" && i === current);
        const active = !done && i === current;
        return (
          <li key={label} aria-current={i === current ? "step" : undefined} className="flex flex-col items-center gap-1.5 text-center">
            <span
              className={cn(
                "grid size-7 place-items-center rounded-full text-[13px] font-extrabold tabular-nums",
                done && "bg-primary text-primary-foreground",
                active && "border-[3px] border-primary bg-card text-secondary-foreground",
                !done && !active && "border-2 border-input bg-card text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-4 stroke-3" aria-hidden /> : i + 1}
            </span>
            <span className={cn("text-xs leading-tight", done || active ? "font-bold text-foreground" : "font-semibold text-muted-foreground")}>
              {label}
              {done && <span className="sr-only"> (selesai)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
