"use client";

/**
 * Desktop (lg+) filter controls for the /discover rail and the /map side panel.
 * On phones the same state is changed through the LocationPill radius dropdown
 * and the "Urutkan" dropdown, so callers render these inside `hidden lg:block`.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RADIUS_OPTIONS, formatRadius, useLocationStore } from "@/stores/location";

export function RailLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="text-xs font-bold text-muted-foreground">
      {children}
    </p>
  );
}

/** Segmented radio group for one-of-few choices (radius, sort). */
export function SegmentedRadio<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-3 text-xs font-bold tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "bg-foreground text-background" : "bg-muted/70 text-foreground/80 hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Radius selector bound to the location store (same state as the LocationPill dropdown). */
export function RadiusSegmented({ className }: { className?: string }) {
  const radius = useLocationStore((s) => s.radius_m);
  const setRadius = useLocationStore((s) => s.setRadius);
  return (
    <div className={cn("space-y-2", className)}>
      <RailLabel>Radius pencarian</RailLabel>
      <SegmentedRadio
        label="Radius pencarian"
        value={radius}
        options={RADIUS_OPTIONS.map((r) => ({ value: r as number, label: formatRadius(r) }))}
        onChange={setRadius}
      />
    </div>
  );
}
