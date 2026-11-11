"use client";

/**
 * Nationwide /map list: every campus/city hub with its warung, grouped by
 * region (Bogor, the platform's home region, first). A row switches the map to
 * the warung around that hub, in the radius its counts were taken in.
 */
import { useId } from "react";
import { ChevronRightIcon, GraduationCapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { hubMetaText, hubRowText, type HubSummary, type RegionSummary } from "./map-scope";

export function HubSummaryList({
  regions,
  onSelect,
  className,
}: {
  regions: RegionSummary[];
  onSelect: (hub: HubSummary) => void;
  className?: string;
}) {
  const baseId = useId();
  return (
    <div className={cn("space-y-5", className)}>
      {regions.map((r) => {
        const headingId = `${baseId}-${r.region.replaceAll(" ", "-")}`;
        return (
          <section key={r.region} aria-labelledby={headingId}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3
                id={headingId}
                className="flex min-w-0 items-center gap-2 text-xs font-bold text-muted-foreground"
              >
                <span className="truncate">{r.region}</span>
                {r.isHome && (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold tracking-normal text-primary normal-case">
                    Pusat
                  </span>
                )}
              </h3>
              <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{hubMetaText(r)}</span>
            </div>
            <ul className="space-y-2">
              {r.hubs.map((h) => {
                const live = h.liveMenus > 0;
                return (
                  <li key={h.hub.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(h)}
                      className="group flex min-h-16 w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-soft ring-1 ring-border transition-all outline-none hover:shadow-card focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
                      aria-label={`${h.hub.name}: ${hubRowText(h)}${live ? `, ${h.portions} porsi` : ""}. Lihat warung di sekitarnya`}
                    >
                      <span
                        className={cn(
                          "inline-flex size-10 shrink-0 items-center justify-center rounded-xl",
                          live ? "bg-brand-soft text-primary" : "bg-muted text-muted-foreground",
                        )}
                        aria-hidden
                      >
                        <GraduationCapIcon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug font-bold [overflow-wrap:anywhere]">{h.hub.name}</span>
                        {/*
                          Wraps between parts, never inside "19 menu live". Each "·" sits in its
                          part's left padding, which falls into the clipped negative margin at
                          the start of a line (as in ImpactLine), so no line starts or ends with one.
                        */}
                        <span className="mt-0.5 block overflow-hidden text-xs text-muted-foreground tabular-nums">
                          <span className="-ml-2 flex flex-wrap">
                            {hubRowText(h)
                              .split(" · ")
                              .map((part) => (
                                <span key={part} className="relative pl-2 whitespace-nowrap">
                                  <span className="absolute inset-y-0 left-0 w-2 text-center" aria-hidden>
                                    ·
                                  </span>
                                  {part}
                                </span>
                              ))}
                          </span>
                        </span>
                      </span>
                      {live && (
                        <span className="shrink-0 rounded-full bg-brand-soft px-2 py-1 text-[11px] leading-none font-bold text-primary tabular-nums">
                          {h.portions} porsi
                        </span>
                      )}
                      <ChevronRightIcon
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
