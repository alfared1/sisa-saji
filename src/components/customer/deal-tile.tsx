"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CheckIcon, PlusIcon } from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { DiscountBadge } from "@/components/common/discount-badge";
import { ImpactLine } from "@/components/common/impact-line";
import { PriceTag } from "@/components/common/price-tag";
import type { BatchCard } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { selectCartQuantityFor, useCartStore, type CartItem, type CartMerchant } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { FoodThumb } from "./food-thumb";
import { usePriceDropFlash } from "./hooks/use-batch-stream";
import { formatDistance } from "./lib/format";
import { cartItemFromBatch, cartMerchantFromBatch } from "./lib/queries";

/**
 * Carousel tile for a single surplus batch (discover sections). The body links
 * to the warung, or — with `onOpenDetail` — is a button "Lihat detail <menu>"
 * that opens the menu detail. The add button keeps its own action.
 */
export function DealTile({
  batch,
  onAdd,
  onOpenDetail,
  width = "w-44",
}: {
  batch: BatchCard;
  onAdd: (merchant: CartMerchant, item: CartItem) => void;
  /** Opens the menu detail sheet instead of navigating to the warung page. */
  onOpenDetail?: () => void;
  width?: string;
}) {
  const hydrated = useStoresHydrated();
  const inCart = useCartStore(selectCartQuantityFor(batch.batch_id));
  const flash = usePriceDropFlash(batch.batch_id);
  const added = hydrated && inCart > 0;

  return (
    <article
      className={cn(
        "group relative shrink-0 snap-start overflow-hidden rounded-3xl bg-card shadow-soft ring-1 ring-border transition-shadow duration-500",
        flash && "ring-2 ring-deal",
        onOpenDetail && "has-[[data-card-body]:focus-visible]:ring-3 has-[[data-card-body]:focus-visible]:ring-ring/50",
        width,
      )}
    >
      {onOpenDetail ? (
        // Stretched button over the tile body; the add button sits above it.
        <button
          type="button"
          data-card-body
          onClick={onOpenDetail}
          className="absolute inset-0 z-10 cursor-pointer rounded-3xl outline-none"
          aria-label={`Lihat detail ${batch.menu_name}`}
        />
      ) : null}
      <Body
        href={onOpenDetail ? null : `/warung/${batch.merchant_slug}`}
        label={`${batch.menu_name} di ${batch.merchant_name}`}
      >
        <FoodThumb
          category={batch.category}
          imageUrl={batch.image_url}
          mystery={batch.is_mystery_bag}
          alt={batch.menu_name}
          className="aspect-[4/3] w-full"
        >
          <DiscountBadge
            pct={batch.discount_pct}
            endIso={batch.pickup_end_time}
            className="absolute top-2 left-2 shadow-soft"
          />
          <CountdownBadge
            endIso={batch.pickup_end_time}
            variant="solid"
            className="absolute bottom-2 left-2 shadow-soft"
          />
          {flash && (
            <span className="absolute top-2 right-2 animate-float-up rounded-full bg-deal px-2 py-1 text-[10px] font-extrabold text-deal-foreground uppercase">
              Harga turun!
            </span>
          )}
        </FoodThumb>
        <div className="space-y-1 p-3 pb-3.5">
          <h3 className="line-clamp-1 text-sm font-bold">{batch.menu_name}</h3>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {batch.merchant_name}
            {batch.distance_m !== null && <> · {formatDistance(batch.distance_m)}</>}
          </p>
          {/*
            Impact runs full width; price + stock sit beside the add button. min-h-12
            keeps this block at least as tall as the button + ring, so a one-line
            impact never sits on top of the button on wide tiles.
          */}
          <ImpactLine portionWeightGrams={batch.portion_weight_grams} className="text-[10.5px]" />
          <div className="min-h-12 space-y-0.5 pt-0.5 pr-12">
            <PriceTag
              original={batch.original_price_idr}
              selling={batch.selling_price_idr}
              showBadge={false}
              size="sm"
            />
            <p
              className={cn(
                "flex flex-wrap gap-x-1 text-[11px] leading-snug font-semibold",
                batch.available_stock <= 3 ? "text-deal" : "text-muted-foreground",
              )}
            >
              {batch.available_stock <= 3 && <span className="whitespace-nowrap">Hampir Habis!</span>}
              <span className="whitespace-nowrap">Sisa {batch.available_stock} porsi</span>
            </p>
          </div>
        </div>
      </Body>
      <button
        type="button"
        onClick={() => onAdd(cartMerchantFromBatch(batch), cartItemFromBatch(batch))}
        className={cn(
          "absolute right-2.5 bottom-3 z-20 inline-flex size-11 items-center justify-center rounded-full shadow-card ring-4 ring-card transition-transform outline-none active:scale-90 focus-visible:ring-ring/50",
          added ? "bg-brand-strong text-primary-foreground" : "bg-primary text-primary-foreground",
        )}
        aria-label={added ? `${batch.menu_name} sudah di keranjang, tambah lagi` : `Tambah ${batch.menu_name} ke keranjang`}
      >
        {added ? <CheckIcon className="size-5" /> : <PlusIcon className="size-5" />}
      </button>
    </article>
  );
}

/** Tile body: a link to the warung, or a plain block under the detail button. */
function Body({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  if (href === null) return <div>{children}</div>;
  return (
    <Link
      href={href}
      className="block outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={label}
    >
      {children}
    </Link>
  );
}
