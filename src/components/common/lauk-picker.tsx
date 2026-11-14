"use client";

import { useId, useRef } from "react";
import type { BatchCard } from "@/lib/contracts";
import { findItem, laukLabel, laukNoun } from "@/lib/lauk";
import { cn } from "@/lib/utils";

type PickerBatch = Pick<BatchCard, "category" | "lauk_available">;

/**
 * Pick one of tonight's lauk (or variant). A radiogroup labelled "Pilih lauk" / "Pilih varian"
 * with one chip per available lauk; arrow keys move the choice. With one lauk left it is a
 * static "Lauk: Ayam goreng" line, and with none it renders nothing. `value` is compared
 * ignoring case; a lauk that is no longer available leaves nothing checked. Where several
 * pickers share a screen (one per cart line), pass `itemName` so each group's accessible name
 * says which menu it belongs to ("Pilih lauk untuk Nasi Rames").
 */
export function LaukPicker({
  batch,
  value,
  onChange,
  itemName,
  size = "md",
  className,
}: {
  batch: PickerBatch;
  value: string | null;
  onChange: (lauk: string) => void;
  itemName?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const options = batch.lauk_available;
  if (options.length === 0) return null;

  const label = laukLabel(batch.category);
  if (options.length === 1) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        <span className="font-semibold text-foreground/80">{laukNoun(batch.category)}:</span> {options[0]}
      </p>
    );
  }

  const selected = value === null ? null : findItem(options, value);
  const focusIndex = Math.max(0, selected === null ? 0 : options.indexOf(selected));

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next]);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <p id={labelId} className={cn("font-semibold text-foreground", size === "sm" ? "text-xs" : "text-sm")}>
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={itemName ? undefined : labelId}
        aria-label={itemName ? `${label} untuk ${itemName}` : undefined}
        className="flex flex-wrap gap-2"
      >
        {options.map((option, i) => {
          const checked = option === selected;
          return (
            <button
              key={option}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === focusIndex ? 0 : -1}
              onClick={() => onChange(option)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={cn(
                "inline-flex shrink-0 items-center rounded-full font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-3.5 text-sm",
                checked
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground/80 ring-1 ring-border hover:bg-muted",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
