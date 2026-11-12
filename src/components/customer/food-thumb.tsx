import type { MenuCategory } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/**
 * Stand-in when a menu or warung has no photo yet: a real photo of a typical dish in
 * the category, blurred so it reads as "a photo goes here" and never as this menu's
 * photo. Sources and licences: public/food-placeholders/CREDITS.md.
 */
const PLACEHOLDERS: Record<MenuCategory, string> = {
  MAKANAN_BERAT: "/food-placeholders/makanan-berat.jpg",
  MAKANAN_RINGAN: "/food-placeholders/makanan-ringan.jpg",
  MAKANAN_VEGAN: "/food-placeholders/makanan-vegan.jpg",
  MINUMAN: "/food-placeholders/minuman.jpg",
  ROTI_PASTRY: "/food-placeholders/roti-pastry.jpg",
  BAHAN_MAKANAN: "/food-placeholders/bahan-makanan.jpg",
  MYSTERY_BAG: "/food-placeholders/paket-kejutan.jpg",
};

/** Menu photo, or a blurred category photo. `noPhotoLabel` says so in words on larger thumbs. */
export function FoodThumb({
  category,
  imageUrl,
  alt,
  mystery = false,
  noPhotoLabel = false,
  className,
  children,
}: {
  category: MenuCategory;
  imageUrl?: string | null;
  alt: string;
  mystery?: boolean;
  noPhotoLabel?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const cat: MenuCategory = mystery ? "MYSTERY_BAG" : category;
  return (
    <div className={cn("relative isolate overflow-hidden bg-food", className)}>
      {imageUrl ? (
        // Remote menu photos come from arbitrary hosts; a plain <img> avoids next/image domain config.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={alt} loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div role={alt ? "img" : undefined} aria-label={alt || undefined} className="absolute inset-0">
          {/* scale-110 pushes the blur's soft edge outside the clipped box. Small unlabelled
              thumbs blur less, or a 48 px tile turns into a brown smudge. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={PLACEHOLDERS[cat]}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className={cn("absolute inset-0 size-full scale-110 object-cover", noPhotoLabel ? "blur-[6px]" : "blur-[3px]")}
          />
          {noPhotoLabel && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white">
                Belum ada foto
              </span>
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
