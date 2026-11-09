"use client";

import { useState } from "react";
import { ChevronDownIcon, EarthIcon, MapPinIcon, NavigationIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useStoresHydrated } from "@/stores/hydration";
import { RADIUS_OPTIONS, formatRadius, useLocationStore } from "@/stores/location";
import { selectShowsIndonesia, useMapScopeStore } from "@/stores/map-scope";
import { LocationSheet } from "./location-sheet";

/** Pill label while /map shows every warung nationwide (the stored location is untouched). */
export const ALL_INDONESIA_LABEL = "Seluruh Indonesia";

/**
 * Sticky-header location: label (opens LocationSheet) + radius selector.
 * `variant="compact"` is the slimmer pill used in the desktop top nav (lg+).
 * While /map is in its nationwide scope the pill reads "Seluruh Indonesia" and
 * hides the radius (any pick in the sheet switches the map to that area).
 */
export function LocationPill({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "compact";
}) {
  const compact = variant === "compact";
  const hydrated = useStoresHydrated();
  const label = useLocationStore((s) => s.label);
  const source = useLocationStore((s) => s.source);
  const radius = useLocationStore((s) => s.radius_m);
  const setRadius = useLocationStore((s) => s.setRadius);
  const allIndonesia = useMapScopeStore(selectShowsIndonesia);
  const pickLocation = useMapScopeStore((s) => s.pickLocation);
  const [open, setOpen] = useState(false);
  const Icon = allIndonesia ? EarthIcon : source === "gps" ? NavigationIcon : MapPinIcon;
  const shown = allIndonesia ? ALL_INDONESIA_LABEL : label;

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group flex min-w-0 flex-1 items-center gap-2 rounded-2xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          compact && "rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-muted",
        )}
        aria-label={`Lokasi: ${shown}. Ubah lokasi`}
      >
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary",
            compact && "size-8 rounded-full",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <span className={cn("block text-[11px] font-medium text-muted-foreground", compact && "truncate leading-tight")}>
            Ambil di sekitar
          </span>
          <span className={cn("flex items-center gap-1 text-sm font-bold", compact && "leading-tight")}>
            <span className={cn("truncate", !hydrated && "opacity-60")}>{shown}</span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-px" />
          </span>
        </span>
      </button>

      {!allIndonesia && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-foreground px-3 text-xs font-bold text-background tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={`Radius ${formatRadius(radius)}. Ubah radius`}
          >
            {formatRadius(radius)}
            <ChevronDownIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 rounded-xl">
            <DropdownMenuLabel>Radius pencarian</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(radius)}
              onValueChange={(v) => {
                setRadius(Number(v));
                pickLocation();
              }}
            >
              {RADIUS_OPTIONS.map((r) => (
                <DropdownMenuRadioItem key={r} value={String(r)} className="tabular-nums">
                  {formatRadius(r)}
                  {r === 2000 && <span className="ml-auto text-[10px] text-muted-foreground">default</span>}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <LocationSheet open={open} onOpenChange={setOpen} />
    </div>
  );
}
