"use client";

import { useState } from "react";
import type { BatchPhotoMeta, MenuCategory } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/**
 * Stand-in when a menu or warung has no photo yet: a real photo of a typical dish in
 * the category, blurred so it reads as "a photo goes here" and never as this menu's
 * photo. Sources and licences: public/food-placeholders/CREDITS.md.
 * (MYSTERY_BAG is only kept so the Record covers the enum; it is never shown.)
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

/**
 * Tonight's batch photo, else the menu photo, else a blurred category photo.
 * `noPhotoLabel` says "Belum ada foto" in words on larger thumbs. A photo that fails to load
 * (a demo photo past its hour, a batch that just ended, a changed session) falls back to the
 * next source instead of a broken image.
 *
 * A PhotoBadge must only show while the batch photo itself is on screen: pass the overlay
 * badge as `photoOverlay` (rendered only then), and use `onPhotoError` to hide a badge
 * rendered elsewhere (the "line" variant). Never badge `imageUrl` or the placeholder.
 */
export function FoodThumb({
  category,
  imageUrl,
  photo,
  alt,
  noPhotoLabel = false,
  photoOverlay,
  onPhotoError,
  className,
  children,
}: {
  category: MenuCategory;
  imageUrl?: string | null;
  photo?: BatchPhotoMeta | null;
  alt: string;
  noPhotoLabel?: boolean;
  photoOverlay?: React.ReactNode;
  onPhotoError?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const src = [photo?.url, imageUrl].find((u): u is string => Boolean(u) && !failed.includes(u as string));
  const showingPhoto = Boolean(photo) && src === photo?.url;

  return (
    <div className={cn("relative isolate overflow-hidden bg-food", className)}>
      {src ? (
        // Batch photos come from the API and menu photos from arbitrary hosts; a plain <img>
        // avoids next/image domain config.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailed((f) => (f.includes(src) ? f : [...f, src]));
            if (src === photo?.url) onPhotoError?.();
          }}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div role={alt ? "img" : undefined} aria-label={alt || undefined} className="absolute inset-0">
          {/* scale-110 pushes the blur's soft edge outside the clipped box. Small unlabelled
              thumbs blur less, or a 48 px tile turns into a brown smudge. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={PLACEHOLDERS[category]}
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
      {showingPhoto && photoOverlay}
      {children}
    </div>
  );
}
