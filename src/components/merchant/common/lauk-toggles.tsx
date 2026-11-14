"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toggle chips for tonight's lauk ("Lauk yang masih ada malam ini"): one chip per menu lauk
 * option, pressed = still available. At least one stays on (the server refuses an empty
 * list when the menu has options), so the last pressed chip cannot be switched off.
 */
export function LaukToggles({
  options,
  value,
  onChange,
  labelledBy,
  disabled = false,
  size = "md",
}: {
  options: readonly string[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** id of the visible heading that names the group. */
  labelledBy: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  if (options.length === 0) return null;
  const on = new Set(value);
  const toggle = (item: string) => {
    if (on.has(item)) {
      if (on.size <= 1) return;
      onChange(options.filter((o) => o !== item && on.has(o)));
    } else {
      onChange(options.filter((o) => o === item || on.has(o)));
    }
  };

  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {options.map((item) => {
        const pressed = on.has(item);
        const last = pressed && on.size <= 1;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={pressed}
            aria-disabled={disabled || last || undefined}
            disabled={disabled}
            title={last ? "Sisakan minimal satu lauk" : undefined}
            onClick={() => toggle(item)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
              size === "sm" ? "h-9 text-xs" : "h-10 text-sm",
              pressed
                ? "bg-brand-soft text-primary ring-primary/40"
                : "bg-card text-muted-foreground line-through decoration-muted-foreground/60 ring-border hover:bg-muted",
              last && "cursor-not-allowed",
            )}
          >
            {pressed && <CheckIcon className="size-3.5 shrink-0" aria-hidden />}
            {item}
          </button>
        );
      })}
    </div>
  );
}
