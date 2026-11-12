"use client";

import Link from "next/link";
import { CheckIcon, PlusIcon } from "lucide-react";
import { FoodThumb } from "@/components/customer/food-thumb";
import type { MenuView } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { roundPortions } from "../lib/logic";

/** Blueprint MenuTemplateSelector — pick a menu or the Paket Kejutan (mystery bag). */
export function MenuTemplateSelector({
  menus,
  value,
  onChange,
  predicted,
  liveMenuIds,
}: {
  menus: MenuView[];
  value: string | null;
  onChange: (id: string) => void;
  predicted: ReadonlyMap<string, number>;
  liveMenuIds: ReadonlySet<string>;
}) {
  // Mystery bags first — they are the easiest way to clear mixed leftovers.
  const ordered = [...menus].sort((a, b) => Number(b.is_mystery_bag) - Number(a.is_mystery_bag));
  return (
    <div>
      <div role="radiogroup" aria-label="Pilih menu" className="grid gap-2 sm:grid-cols-2">
        {ordered.map((m) => {
          const selected = m.id === value;
          const pred = predicted.get(m.id);
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(m.id)}
              className={cn(
                "relative flex min-h-16 items-center gap-3 rounded-2xl p-3 text-left ring-1 transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]",
                selected
                  ? m.is_mystery_bag
                    ? "bg-deal-soft ring-2 ring-deal"
                    : "bg-brand-soft ring-2 ring-primary"
                  : m.is_mystery_bag
                    ? "bg-gradient-to-br from-deal-soft/80 to-card ring-deal/30 hover:ring-deal/60"
                    : "bg-card ring-border hover:bg-muted/60",
              )}
            >
              <FoodThumb
                category={m.category}
                mystery={m.is_mystery_bag}
                imageUrl={m.image_url}
                alt=""
                className="size-11 shrink-0 rounded-xl"
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-sm leading-tight font-semibold">{m.menu_name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                  {formatIdr(m.original_price_idr)} · min {formatIdr(m.min_recovery_price_idr)}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {m.is_mystery_bag && (
                    <span className="rounded-full bg-deal px-1.5 py-0.5 text-[10px] leading-none font-semibold text-deal-foreground">Paket Kejutan</span>
                  )}
                  {pred !== undefined && pred > 0 && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] leading-none font-semibold text-primary">
                      Perkiraan ±{roundPortions(pred)} sisa
                    </span>
                  )}
                  {liveMenuIds.has(m.id) && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none font-semibold text-muted-foreground">Sedang tayang</span>
                  )}
                </span>
              </span>
              <span
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full ring-1",
                  selected ? (m.is_mystery_bag ? "bg-deal text-deal-foreground ring-deal" : "bg-primary text-primary-foreground ring-primary") : "ring-border",
                )}
                aria-hidden
              >
                {selected && <CheckIcon className="size-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
      <Link
        href="/merchant/menus?baru=1"
        className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <PlusIcon className="size-4" /> Tambah menu baru
      </Link>
    </div>
  );
}
