"use client";

import { Clock3Icon } from "lucide-react";
import { useCountdown } from "@/hooks/use-countdown";
import { formatClockId } from "@/lib/time";
import { cn } from "@/lib/utils";
import { formatCountdownText } from "./countdown-format";

/**
 * Live countdown to a closing / pickup deadline: "Tutup dalam 01:15:20" (formatCountdownText).
 * A custom prefix must also read as a duration ("Ambil dalam", "Bayar dalam"), never a bare
 * verb. Turns red & pulses under 45 minutes; shows "Sudah tutup" once over. Renders the
 * static clock time ("s/d 22.30") until the client clock is ready, so SSR output is stable.
 */
export function CountdownBadge({
  endIso,
  prefix = "Tutup dalam",
  overLabel = "Sudah tutup",
  variant = "soft",
  className,
}: {
  endIso: string;
  prefix?: string;
  overLabel?: string;
  variant?: "soft" | "solid" | "plain";
  className?: string;
}) {
  const c = useCountdown(endIso);
  const urgent = c.isUrgent;
  const over = c.isOver;

  const text = !c.ready
    ? `s/d ${formatClockId(endIso)}`
    : over
      ? overLabel
      : formatCountdownText(c, prefix);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full text-xs font-semibold tabular-nums leading-none",
        variant !== "plain" && "px-2 py-1",
        variant === "soft" &&
          (over
            ? "bg-muted text-muted-foreground"
            : urgent
              ? "bg-urgent-soft text-urgent"
              : "bg-secondary text-secondary-foreground"),
        variant === "solid" &&
          (over ? "bg-muted text-muted-foreground" : urgent ? "bg-urgent text-urgent-foreground" : "bg-primary text-primary-foreground"),
        variant === "plain" && (over ? "text-muted-foreground" : urgent ? "text-urgent" : "text-muted-foreground"),
        className,
      )}
      role="timer"
      aria-live="off"
      title={`Batas ${formatClockId(endIso)} WIB`}
    >
      <Clock3Icon className={cn("size-3.5", urgent && !over && "animate-soft-pulse")} aria-hidden />
      {text}
    </span>
  );
}
