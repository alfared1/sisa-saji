"use client";

import type { ComponentType } from "react";
import {
  CakeSliceIcon,
  CarrotIcon,
  CupSodaIcon,
  GiftIcon,
  CookieIcon,
  LayoutGridIcon,
  SaladIcon,
  UtensilsIcon,
} from "lucide-react";
import { MENU_CATEGORIES, MENU_CATEGORY_LABELS, type MenuCategory } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<MenuCategory, ComponentType<{ className?: string }>> = {
  MAKANAN_BERAT: UtensilsIcon,
  MAKANAN_RINGAN: CookieIcon,
  MAKANAN_VEGAN: SaladIcon,
  MINUMAN: CupSodaIcon,
  ROTI_PASTRY: CakeSliceIcon,
  BAHAN_MAKANAN: CarrotIcon,
  MYSTERY_BAG: GiftIcon,
};

/** Horizontally scrollable category filter ("Semua" + MENU_CATEGORY_LABELS). */
export function CategoryChips({
  value,
  onChange,
  categories = MENU_CATEGORIES,
  showAll = true,
  className,
}: {
  value: MenuCategory | null;
  onChange: (value: MenuCategory | null) => void;
  categories?: readonly MenuCategory[];
  showAll?: boolean;
  className?: string;
}) {
  const chips: { key: MenuCategory | null; label: string; Icon: ComponentType<{ className?: string }> }[] = [
    ...(showAll ? [{ key: null, label: "Semua", Icon: LayoutGridIcon }] : []),
    ...categories.map((c) => ({ key: c, label: MENU_CATEGORY_LABELS[c], Icon: CATEGORY_ICONS[c] })),
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Kategori"
      className={cn("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1", className)}
    >
      {chips.map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key ?? "all"}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-foreground text-background shadow-soft"
                : "bg-card text-foreground/80 ring-1 ring-border hover:bg-muted",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
