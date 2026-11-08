"use client";

import { SparklesIcon, TrendingDownIcon } from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { DiscountBadge } from "@/components/common/discount-badge";
import { ImpactLine } from "@/components/common/impact-line";
import { PriceTag } from "@/components/common/price-tag";
import { StockBadge } from "@/components/common/stock-badge";
import { Button } from "@/components/ui/button";
import type { BatchCard } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { selectCartQuantityFor, useCartStore, type CartItem, type CartMerchant } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { QtyStepper } from "./bits";
import { FoodThumb } from "./food-thumb";
import { usePriceDropFlash } from "./hooks/use-batch-stream";
import { cartItemFromBatch } from "./lib/queries";

/**
 * DynamicPriceMenuCard — a live surplus batch on the warung page: photo or
 * placeholder, strike → selling price, "Harga Turun Otomatis", live stock and
 * closing countdown, impact estimate, and an add button that becomes a
 * quantity stepper. With `onOpenDetail`, tapping the card body (photo / name)
 * opens the menu detail; the add button / stepper keep their own action.
 */
export function DynamicPriceMenuCard({
  batch,
  merchant,
  disabled = false,
  disabledLabel = "Tutup",
  onAdd,
  onOpenDetail,
}: {
  batch: BatchCard;
  merchant: CartMerchant;
  disabled?: boolean;
  disabledLabel?: string;
  onAdd: (merchant: CartMerchant, item: CartItem) => void;
  /** Opens the menu detail sheet; makes the card body a button "Lihat detail <menu>". */
  onOpenDetail?: () => void;
}) {
  const hydrated = useStoresHydrated();
  const qtyInCart = useCartStore(selectCartQuantityFor(batch.batch_id));
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const flash = usePriceDropFlash(batch.batch_id);
  const soldOut = batch.available_stock <= 0;
  const inactive = soldOut || disabled;
  const qty = hydrated ? qtyInCart : 0;

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
        mystery={batch.is_mystery_bag}
        alt={batch.menu_name}
        className={cn("size-26 shrink-0 rounded-2xl", inactive && "grayscale")}
      >
        {!inactive && (
          <DiscountBadge
            pct={batch.discount_pct}
            endIso={batch.pickup_end_time}
            size="sm"
            className="absolute top-1.5 left-1.5 shadow-soft"
          />
        )}
        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-foreground/45 text-xs font-extrabold tracking-wide text-background uppercase">
            Habis
          </span>
        )}
      </FoodThumb>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <h3 className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug font-bold">{batch.menu_name}</h3>
        </div>
        {batch.is_mystery_bag ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
            <SparklesIcon className="size-3.5" /> Paket kejutan — isi pilihan warung
          </p>
        ) : (
          batch.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{batch.description}</p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {batch.auto_discount_enabled && !inactive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-deal-soft px-2 py-1 text-[11px] leading-none font-bold text-deal">
              <TrendingDownIcon className="size-3" aria-hidden /> Harga Turun Otomatis
            </span>
          )}
          <StockBadge available={batch.available_stock} />
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            {flash && (
              <span className="mb-0.5 block animate-float-up text-[11px] font-extrabold text-deal uppercase">
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
            {!inactive && <CountdownBadge endIso={batch.pickup_end_time} prefix="Tutup" variant="plain" className="mt-1" />}
          </div>

          <div className="relative z-10 shrink-0">
            {inactive ? (
              <span className="rounded-full bg-muted px-3 py-2 text-xs font-bold text-muted-foreground">
                {soldOut ? "Habis" : disabledLabel}
              </span>
            ) : qty > 0 ? (
              <QtyStepper
                value={qty}
                min={0}
                max={Math.min(batch.available_stock, 10)}
                size="sm"
                label={batch.menu_name}
                onChange={(v) => (v <= 0 ? removeItem(batch.batch_id) : setQuantity(batch.batch_id, v))}
              />
            ) : (
              <Button
                className="h-10 shrink-0 rounded-full px-4 font-bold shadow-soft"
                onClick={() => onAdd(merchant, cartItemFromBatch(batch))}
                aria-label={`Tambah ${batch.menu_name} ke keranjang`}
              >
                Tambah
              </Button>
            )}
          </div>
        </div>
        {!soldOut && <ImpactLine portionWeightGrams={batch.portion_weight_grams} className="mt-1.5" />}
      </div>
    </article>
  );
}
