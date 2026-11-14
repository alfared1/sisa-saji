"use client";

import { useState } from "react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { DiscountBadge } from "@/components/common/discount-badge";
import { ImpactLine } from "@/components/common/impact-line";
import { LaukSummary } from "@/components/common/lauk-summary";
import { PhotoBadge } from "@/components/common/photo-badge";
import { PriceTag } from "@/components/common/price-tag";
import { StockBadge } from "@/components/common/stock-badge";
import { TrustBadges } from "@/components/common/trust-badges";
import { Button } from "@/components/ui/button";
import type { BatchCard } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import type { CartItem, CartMerchant } from "@/stores/cart";
import { QtyStepper, useBatchCartStepper, useDistanceOrigin } from "./bits";
import { FoodThumb } from "./food-thumb";
import { usePriceDropFlash } from "./hooks/use-batch-stream";
import { distanceLine } from "./lib/format";
import { cartItemFromBatch } from "./lib/queries";

/**
 * DynamicPriceMenuCard: a live surplus batch on the warung page (and in "Menu yang Cocok"
 * on /discover): photo or placeholder, what is in the portion and the lauk still available,
 * strike → selling price, "Harga Turun Otomatis", live stock and "Tutup dalam" countdown,
 * impact estimate, and an add button that becomes a quantity stepper. Tonight's photo gets
 * a "Foto asli etalase pukul 19.45 WIB" line, hidden again if the photo stops loading.
 * With `showMerchant` it also names the warung and its distance, plus the hygiene and
 * portion chips. With `onOpenDetail`, tapping the card body (photo / name) opens the menu
 * detail; the add button / stepper keep their own action.
 */
export function DynamicPriceMenuCard({
  batch,
  merchant,
  disabled = false,
  disabledLabel = "Tutup",
  showMerchant = false,
  onAdd,
  onOpenDetail,
}: {
  batch: BatchCard;
  merchant: CartMerchant;
  disabled?: boolean;
  disabledLabel?: string;
  /** Adds "warung · distance" and the trust chips (lists that mix warung). */
  showMerchant?: boolean;
  onAdd: (merchant: CartMerchant, item: CartItem) => void;
  /** Opens the menu detail sheet; makes the card body a button "Lihat detail <menu>". */
  onOpenDetail?: () => void;
}) {
  const { qty, lines, onChange } = useBatchCartStepper(batch.batch_id);
  const flash = usePriceDropFlash(batch.batch_id);
  const origin = useDistanceOrigin();
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const soldOut = batch.available_stock <= 0;
  const inactive = soldOut || disabled;
  const listed = batch.contents.length > 0 || batch.lauk_options.length > 0;
  const distance = distanceLine(batch.distance_m, origin, "short");
  const chosenLauk = lines.filter((l) => l.lauk !== null);
  const photoShown = batch.photo !== null && batch.photo.url !== failedPhotoUrl;

  return (
    <article
      className={cn(
        "relative flex gap-3 rounded-3xl bg-card p-3 shadow-soft ring-1 ring-border transition-[box-shadow,background-color] duration-500",
        flash && "bg-deal-soft/60 ring-2 ring-deal",
        inactive && "opacity-75",
        onOpenDetail && "has-[[data-card-body]:focus-visible]:ring-3 has-[[data-card-body]:focus-visible]:ring-ring/50",
      )}
      aria-label={batch.menu_name}
    >
      {onOpenDetail && (
        // Stretched button: the whole card body opens the detail; the add
        // button / stepper sit above it (z-10) with their own action.
        <button
          type="button"
          data-card-body
          onClick={onOpenDetail}
          className="absolute inset-0 z-[1] cursor-pointer rounded-3xl outline-none"
          aria-label={`Lihat detail ${batch.menu_name}`}
        />
      )}
      <FoodThumb
        category={batch.category}
        imageUrl={batch.image_url}
        photo={batch.photo}
        alt={batch.menu_name}
        className={cn("size-26 shrink-0 rounded-2xl", inactive && "grayscale")}
        noPhotoLabel={!soldOut}
        onPhotoError={() => setFailedPhotoUrl(batch.photo?.url ?? null)}
      >
        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-foreground/45 text-xs font-semibold text-background uppercase">
            Habis
          </span>
        )}
      </FoodThumb>

      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold">{batch.menu_name}</h3>
        {showMerchant && (
          <>
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{batch.merchant_name}</p>
            {/* Own line, so a long warung name never clamps the walking distance away. */}
            {distance && <p className="text-xs text-muted-foreground tabular-nums">{distance}</p>}
          </>
        )}
        {listed ? (
          <LaukSummary batch={batch} lines={2} className="mt-1" />
        ) : (
          batch.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{batch.description}</p>
        )}
        {batch.photo && photoShown && <PhotoBadge photo={batch.photo} variant="line" className="mt-1" />}

        {/* One chip size for the row: 24 px tall, 11 px text, 12 px icons (the badges' own sizes differ). */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1 *:h-6">
          {/* The discount badge lives with the chips: on the 104 px photo it covered the food icon. */}
          {!inactive && (
            <DiscountBadge pct={batch.discount_pct} endIso={batch.pickup_end_time} size="sm" className="px-2" />
          )}
          {batch.auto_discount_enabled && !inactive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-deal-soft px-2 py-1 text-[11px] leading-none font-semibold text-deal">
              Harga Turun Otomatis
            </span>
          )}
          <StockBadge available={batch.available_stock} className="text-[11px] [&>svg]:size-3" />
          {/* The warung page shows its review signals once in the header; here only tonight's disclosure. */}
          {!showMerchant && !batch.full_portion && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-[11px] leading-none font-semibold text-foreground/80">
              Porsi lebih kecil
            </span>
          )}
        </div>
        {showMerchant && (
          <TrustBadges
            trust={batch.merchant_trust}
            variant="short"
            fullPortion={batch.full_portion}
            className="mt-1.5 gap-1 [&>li]:px-2 [&>li]:text-[11px]"
          />
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            {flash && (
              <span className="mb-0.5 block animate-float-up text-[11px] font-semibold text-deal">
                Harga turun!
              </span>
            )}
            <PriceTag
              original={batch.original_price_idr}
              selling={batch.selling_price_idr}
              discountPct={batch.discount_pct}
              showBadge={false}
              layout="stacked"
            />
            {!inactive && <CountdownBadge endIso={batch.pickup_end_time} variant="plain" className="mt-1" />}
          </div>

          <div className="relative z-10 shrink-0">
            {inactive ? (
              <span className="rounded-full bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                {soldOut ? "Habis" : disabledLabel}
              </span>
            ) : qty > 0 ? (
              <QtyStepper
                value={qty}
                min={0}
                max={Math.min(batch.available_stock, 10)}
                size="sm"
                label={batch.menu_name}
                onChange={onChange}
              />
            ) : (
              <Button
                className="h-10 shrink-0 rounded-full px-4 font-semibold shadow-soft"
                onClick={() => onAdd(merchant, cartItemFromBatch(batch))}
                aria-label={`Tambah ${batch.menu_name} ke keranjang`}
              >
                Tambah
              </Button>
            )}
          </div>
        </div>
        {chosenLauk.length > 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground/80">Di keranjang:</span>{" "}
            {chosenLauk.map((l) => `${l.quantity}× ${l.lauk}`).join(", ")}
          </p>
        )}
        {!soldOut && <ImpactLine portionWeightGrams={batch.portion_weight_grams} className="mt-1.5" />}
      </div>
    </article>
  );
}
