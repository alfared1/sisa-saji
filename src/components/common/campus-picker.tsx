"use client";

import { useId, useState } from "react";
import { CheckIcon, GraduationCapIcon, SearchIcon, XIcon } from "lucide-react";
import { campusesByRegion, filterCampuses, isHomeRegion } from "@/lib/campuses";
import type { CampusId } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Campus / city chooser for ~20 hubs: a filter box plus the hubs grouped by
 * region (Bogor first). Shared by the location sheet and the profile editor.
 */
export function CampusPicker({
  value,
  onSelect,
  className,
}: {
  value: CampusId | null;
  onSelect: (id: CampusId) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const baseId = useId();
  const matches = filterCampuses(query);
  const groups = campusesByRegion(matches);

  return (
    <div className={cn("space-y-3", className)}>
      <label className="relative flex h-11 items-center">
        <span className="sr-only">Cari kampus atau kota</span>
        <SearchIcon className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground" aria-hidden />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          value={query}
          maxLength={40}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Inside the profile <form>, Enter must filter, not submit the whole profile.
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (matches.length === 1) onSelect(matches[0].id);
          }}
          placeholder="Cari kampus atau kota"
          className="h-11 w-full rounded-2xl bg-muted/80 pr-10 pl-10 text-sm font-medium ring-1 ring-transparent transition outline-none placeholder:text-muted-foreground focus:bg-card focus:ring-ring/60 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-1 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Hapus pencarian kampus"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </label>

      {groups.length === 0 && (
        <p className="rounded-2xl bg-muted/60 px-3 py-4 text-center text-sm text-muted-foreground">
          Belum ada kampus atau kota dengan nama itu.
        </p>
      )}

      {groups.map((g) => {
        const headingId = `${baseId}-${g.region.replaceAll(" ", "-")}`;
        return (
          <div key={g.region} role="group" aria-labelledby={headingId}>
            <h4
              id={headingId}
              className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {g.region}
              {isHomeRegion(g.region) && (
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold tracking-normal text-primary normal-case">
                  Pusat
                </span>
              )}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {g.campuses.map((c) => {
                const active = value === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      "flex min-h-12 items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      active ? "bg-brand-soft ring-primary/50" : "bg-card ring-border hover:bg-muted",
                    )}
                  >
                    <GraduationCapIcon
                      className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 leading-tight [overflow-wrap:anywhere]">{c.name}</span>
                    {active && <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
