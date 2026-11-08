import { CATEGORY_ICONS } from "@/components/common/category-chips";
import type { MenuCategory } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/** Warm per-category gradients used when a menu has no photo. */
const TINTS: Record<MenuCategory, string> = {
  MAKANAN_BERAT: "from-amber-100 via-orange-100 to-orange-200 text-orange-700 dark:via-orange-900/70 dark:from-orange-950 dark:to-amber-900 dark:text-orange-300",
  MAKANAN_RINGAN: "from-yellow-100 via-amber-100 to-yellow-200 text-amber-700 dark:via-amber-900/70 dark:from-amber-950 dark:to-yellow-900 dark:text-amber-300",
  MAKANAN_VEGAN: "from-emerald-100 via-lime-100 to-green-200 text-green-700 dark:via-green-900/70 dark:from-green-950 dark:to-emerald-900 dark:text-green-300",
  MINUMAN: "from-sky-100 via-cyan-100 to-sky-200 text-sky-700 dark:via-sky-900/70 dark:from-sky-950 dark:to-cyan-900 dark:text-sky-300",
  ROTI_PASTRY: "from-rose-100 via-orange-50 to-amber-200 text-rose-700 dark:via-rose-900/70 dark:from-rose-950 dark:to-amber-900 dark:text-rose-300",
  BAHAN_MAKANAN: "from-lime-100 via-green-50 to-lime-200 text-lime-700 dark:via-lime-900/70 dark:from-lime-950 dark:to-green-900 dark:text-lime-300",
  MYSTERY_BAG: "from-violet-100 via-fuchsia-100 to-purple-200 text-violet-700 dark:via-violet-900/70 dark:from-violet-950 dark:to-fuchsia-900 dark:text-violet-300",
};

/** Menu photo, or a category-tinted placeholder with its icon. */
export function FoodThumb({
  category,
  imageUrl,
  alt,
  mystery = false,
  className,
  iconClassName,
  children,
}: {
  category: MenuCategory;
  imageUrl?: string | null;
  alt: string;
  mystery?: boolean;
  className?: string;
  iconClassName?: string;
  children?: React.ReactNode;
}) {
  const cat: MenuCategory = mystery ? "MYSTERY_BAG" : category;
  const Icon = CATEGORY_ICONS[cat];
  return (
    <div className={cn("relative isolate overflow-hidden bg-muted", className)}>
      {imageUrl ? (
        // Remote menu photos come from arbitrary hosts; a plain <img> avoids next/image domain config.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={alt} loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className={cn("absolute inset-0 flex items-center justify-center bg-gradient-to-br", TINTS[cat])}
        >
          <span className="absolute -right-3 -bottom-4 size-16 rounded-full bg-white/35 dark:bg-white/5" aria-hidden />
          <span className="absolute -top-5 -left-4 size-14 rounded-full bg-white/30 dark:bg-white/5" aria-hidden />
          <Icon className={cn("relative size-9 drop-shadow-sm", iconClassName)} />
        </div>
      )}
      {children}
    </div>
  );
}
