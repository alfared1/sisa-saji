"use client";

import Link from "next/link";
import { CheckIcon, PlusIcon } from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { DiscountBadge } from "@/components/common/discount-badge";
import { PriceTag } from "@/components/common/price-tag";
import type { BatchCard } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { selectCartQuantityFor, useCartStore, type CartItem, type CartMerchant } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { FoodThumb } from "./food-thumb";
import { usePriceDropFlash } from "./hooks/use-batch-stream";
import { formatDistance } from "./lib/format";
import { cartItemFromBatch, cartMerchantFromBatch } from "./lib/queries";

/** Carousel tile for a single surplus batch (discover sections). */
export function DealTile({
  batch,
  onAdd,
  width = "w-44",
}: {
  batch: BatchCard;
  onAdd: (merchant: CartMerchant, item: CartItem) => void;
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
        width,
      )}
    >
      <Link
        href={`/warung/${batch.merchant_slug}`}
        className="block outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`${batch.menu_name} di ${batch.merchant_name}`}
      >
        <FoodThumb
          category={batch.category}
          imageUrl={batch.image_url}
          mystery={batch.is_mystery_bag}
          alt={batch.menu_name}
          className="aspect-[4/3] w-full"
        >
          <DiscountBadge pct={batch.discount_pct} className="absolute top-2 left-2 shadow-soft" />
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
          <PriceTag
            original={batch.original_price_idr}
            selling={batch.selling_price_idr}
            showBadge={false}
            size="sm"
            className="pr-9"
          />
          <p className={cn("text-[11px] font-semibold", batch.available_stock <= 3 ? "text-deal" : "text-muted-foreground")}>
            Sisa {batch.available_stock} porsi
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onAdd(cartMerchantFromBatch(batch), cartItemFromBatch(batch))}
        className={cn(
          "absolute right-2.5 bottom-3 inline-flex size-11 items-center justify-center rounded-full shadow-card ring-4 ring-card transition-transform outline-none active:scale-90 focus-visible:ring-ring/50",
          added ? "bg-brand-strong text-primary-foreground" : "bg-primary text-primary-foreground",
        )}
        aria-label={added ? `${batch.menu_name} sudah di keranjang, tambah lagi` : `Tambah ${batch.menu_name} ke keranjang`}
      >
        {added ? <CheckIcon className="size-5" /> : <PlusIcon className="size-5" />}
      </button>
    </article>
  );
}
