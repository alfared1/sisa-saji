"use client";

import { useId } from "react";
import { AlertCircleIcon, Clock3Icon, StoreIcon } from "lucide-react";
import { MINUTE_MS, formatClockId } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  QUICK_WINDOW_MINUTES,
  ceilTo5Minutes,
  checkPickupEnd,
  clockValue,
  closingTimeToday,
  endFromClock,
  formatDuration,
} from "../lib/logic";

/** Blueprint PickupWindowConfirm — when does pickup end tonight? */
export function PickupWindowConfirm({
  endMs,
  nowMs,
  closeTime,
  onChange,
}: {
  endMs: number | null;
  nowMs: number | null;
  closeTime: string;
  onChange: (endMs: number) => void;
}) {
  const inputId = useId();
  const errorId = useId();
  const ready = endMs !== null && nowMs !== null;
  const check = ready ? checkPickupEnd(endMs, nowMs) : null;
  const closeMs = nowMs !== null ? closingTimeToday(closeTime, nowMs) : null;
  const closeValid = closeMs !== null && nowMs !== null && checkPickupEnd(closeMs, nowMs).ok;

  const chips: { key: string; label: string; ms: number; icon?: boolean }[] = [];
  if (nowMs !== null) {
    if (closeValid && closeMs !== null) chips.push({ key: "close", label: `Jam tutup ${formatClockId(new Date(closeMs))}`, ms: closeMs, icon: true });
    for (const m of QUICK_WINDOW_MINUTES) chips.push({ key: `+${m}`, label: `+${m} mnt`, ms: ceilTo5Minutes(nowMs + m * MINUTE_MS) });
  }

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl p-3 ring-1",
          check && !check.ok ? "bg-urgent-soft ring-urgent/30" : "bg-surface ring-border",
        )}
      >
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-primary ring-1 ring-border">
          <Clock3Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="block text-[11px] font-semibold text-muted-foreground">
            Batas ambil (WIB)
          </label>
          <div className="flex items-baseline gap-2">
            <input
              id={inputId}
              type="time"
              value={endMs !== null ? clockValue(endMs) : ""}
              disabled={nowMs === null}
              aria-invalid={check && !check.ok ? true : undefined}
              aria-describedby={check && !check.ok ? errorId : undefined}
              onChange={(e) => {
                if (nowMs === null) return;
                const ms = endFromClock(e.target.value, nowMs);
                if (ms !== null) onChange(ms);
              }}
              className="h-9 w-[7.5rem] rounded-lg bg-transparent text-2xl font-extrabold tabular-nums outline-none focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            {ready && check?.ok && (
              <span className="text-xs font-semibold text-muted-foreground">{formatDuration((endMs - nowMs) / MINUTE_MS)} lagi</span>
            )}
          </div>
        </div>
      </div>

      {check && !check.ok && (
        <p id={errorId} role="alert" className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-urgent">
          <AlertCircleIcon className="size-4" /> {check.message}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Pilih cepat batas ambil">
        {chips.map((c) => {
          const active = endMs !== null && Math.abs(endMs - c.ms) < MINUTE_MS;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onChange(c.ms)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold tabular-nums ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "bg-foreground text-background ring-foreground" : "bg-card ring-border hover:bg-muted",
              )}
            >
              {c.icon && <StoreIcon className="size-3.5" aria-hidden />}
              {c.label}
            </button>
          );
        })}
      </div>
      {!closeValid && nowMs !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Jam tutup warung ({closeTime.replace(":", ".")}) di luar jendela 10 menit – 12 jam dari sekarang, jadi kami sarankan +2 jam.
        </p>
      )}
    </div>
  );
}
