"use client";

import Link from "next/link";
import { ChevronRightIcon, MapPinIcon, StarIcon } from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { DiscountBadge } from "@/components/common/discount-badge";
import { StockBadge } from "@/components/common/stock-badge";
import { VerifiedBadge } from "@/components/common/verified-badge";
import type { MerchantSummary } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { FoodThumb } from "./food-thumb";
import { formatDistance, formatRating, travelMinutes } from "./lib/format";

type MerchantCardData = Pick<
  MerchantSummary,
  | "slug"
  | "name"
  | "category"
  | "address"
  | "distance_m"
  | "is_verified"
  | "rating_avg"
  | "total_reviews"
  | "logo_url"
  | "max_discount_pct"
  | "min_price_idr"
  | "total_available_stock"
  | "closes_at"
> & { batches?: MerchantSummary["batches"] };

/** MerchantCard — a warung in "Mitra Terdekat" and the map preview sheet. */
export function MerchantCard({
  merchant,
  variant = "list",
  className,
}: {
  merchant: MerchantCardData;
  variant?: "list" | "sheet";
  className?: string;
}) {
  const soldOut = merchant.total_available_stock <= 0;
  const walk = travelMinutes(merchant.distance_m);
  const menuPreview = merchant.batches
    ?.filter((b) => b.available_stock > 0)
    .slice(0, 3)
    .map((b) => b.menu_name)
    .join(" · ");

  return (
    <Link
      href={`/warung/${merchant.slug}`}
      className={cn(
        "group flex gap-3 rounded-3xl bg-card p-3 shadow-soft ring-1 ring-border transition-all outline-none hover:shadow-card focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]",
        soldOut && "opacity-70",
        className,
      )}
      aria-label={`${merchant.name}${merchant.distance_m !== null ? `, ${formatDistance(merchant.distance_m)}` : ""}`}
    >
      <FoodThumb
        category={merchant.category}
        imageUrl={merchant.logo_url}
        alt=""
        className={cn("shrink-0 rounded-2xl", variant === "sheet" ? "size-20" : "size-[4.5rem]", soldOut && "grayscale")}
        iconClassName="size-7"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <h3 className="truncate text-[15px] font-bold">{merchant.name}</h3>
          {merchant.is_verified && <VerifiedBadge compact />}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-0.5 font-semibold text-foreground">
            <StarIcon className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
            {formatRating(merchant.rating_avg)}
          </span>
          <span>({merchant.total_reviews})</span>
          {merchant.distance_m !== null && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5">
                <MapPinIcon className="size-3" aria-hidden />
                {formatDistance(merchant.distance_m)}
                {walk !== null && <span className="hidden min-[380px]:inline"> · {walk} mnt jalan</span>}
              </span>
            </>
          )}
        </p>
        {menuPreview && variant === "sheet" && (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{menuPreview}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StockBadge available={merchant.total_available_stock} />
          {!soldOut && merchant.closes_at && <CountdownBadge endIso={merchant.closes_at} />}
        </div>
        {!soldOut && (merchant.min_price_idr > 0 || merchant.max_discount_pct > 0) && (
          // Badge sits here (not on the 72 px thumb) so "Flash Rescue s/d 70%" is never clipped.
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {merchant.min_price_idr > 0 && (
              <p className="text-xs text-muted-foreground">
                Mulai <span className="font-extrabold text-foreground tabular-nums">{formatIdr(merchant.min_price_idr)}</span>
              </p>
            )}
            {merchant.max_discount_pct > 0 && (
              <DiscountBadge pct={merchant.max_discount_pct} endIso={merchant.closes_at} upTo size="sm" />
            )}
          </div>
        )}
      </div>
      <ChevronRightIcon className="size-5 shrink-0 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
