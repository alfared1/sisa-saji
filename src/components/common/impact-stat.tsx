import { CloudIcon, LeafIcon, TreesIcon } from "lucide-react";
import { formatKg, treeYearsFromCo2Grams } from "@/lib/impact";
import { cn } from "@/lib/utils";

/** Pair of impact numbers: kg pangan diselamatkan + kg CO₂e dicegah. */
export function ImpactStat({
  foodGrams,
  co2Grams,
  showTrees = false,
  variant = "card",
  className,
}: {
  foodGrams: number;
  co2Grams: number;
  showTrees?: boolean;
  /** card: two tiles; inline: compact one-liner; hero: large on brand background. */
  variant?: "card" | "inline" | "hero";
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium", className)}>
        <span className="inline-flex items-center gap-1 text-primary">
          <LeafIcon className="size-3.5" aria-hidden />
          <span className="tabular-nums">+{formatKg(foodGrams)}</span> pangan
        </span>
        <span className="inline-flex items-center gap-1 text-brand-strong">
          <CloudIcon className="size-3.5" aria-hidden />
          <span className="tabular-nums">{formatKg(co2Grams)}</span> CO₂e dicegah
        </span>
      </span>
    );
  }

  const hero = variant === "hero";
  const tiles = [
    {
      key: "food",
      icon: LeafIcon,
      value: formatKg(foodGrams),
      label: "pangan diselamatkan",
      tint: hero ? "bg-white/15 text-white" : "bg-brand-soft text-brand-strong",
    },
    {
      key: "co2",
      icon: CloudIcon,
      value: formatKg(co2Grams),
      label: "CO₂e dicegah",
      tint: hero ? "bg-white/15 text-white" : "bg-brand-soft text-brand-strong",
    },
    ...(showTrees
      ? [
          {
            key: "trees",
            icon: TreesIcon,
            value: treeYearsFromCo2Grams(co2Grams).toLocaleString("id-ID", { maximumFractionDigits: 1 }),
            label: "pohon / tahun",
            tint: hero ? "bg-white/15 text-white" : "bg-brand-soft text-brand-strong",
          },
        ]
      : []),
  ];

  return (
    <div className={cn("grid gap-2", showTrees ? "grid-cols-3" : "grid-cols-2", className)}>
      {tiles.map((t) => (
        <div
          key={t.key}
          className={cn(
            "flex min-w-0 flex-col gap-1.5 rounded-2xl p-3",
            hero ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-card ring-1 ring-border",
          )}
        >
          <span className={cn("inline-flex size-8 items-center justify-center rounded-xl", t.tint)}>
            <t.icon className="size-4" aria-hidden />
          </span>
          <span className="truncate text-lg font-extrabold leading-tight tabular-nums">{t.value}</span>
          <span className={cn("text-xs leading-tight", hero ? "text-white/80" : "text-muted-foreground")}>
            {t.label}
          </span>
        </div>
      ))}
    </div>
  );
}
