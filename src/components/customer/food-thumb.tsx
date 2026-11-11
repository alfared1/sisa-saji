import { CATEGORY_ICONS } from "@/components/common/category-chips";
import type { MenuCategory } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/**
 * Placeholder when a menu has no photo: one warm tint for every category (the
 * icon tells the category apart), orange only for the Paket Kejutan.
 */
const TINTS: Record<MenuCategory, string> = {
  MAKANAN_BERAT: "bg-food text-food-ink",
  MAKANAN_RINGAN: "bg-food text-food-ink",
  MAKANAN_VEGAN: "bg-food text-food-ink",
  MINUMAN: "bg-food text-food-ink",
  ROTI_PASTRY: "bg-food text-food-ink",
  BAHAN_MAKANAN: "bg-food text-food-ink",
  MYSTERY_BAG: "bg-deal-soft text-deal",
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
          className={cn("absolute inset-0 flex items-center justify-center", TINTS[cat])}
        >
          <Icon className={cn("size-9", iconClassName)} aria-hidden />
        </div>
      )}
      {children}
    </div>
  );
}
