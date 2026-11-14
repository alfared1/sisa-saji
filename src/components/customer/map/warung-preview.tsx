"use client";

/**
 * Preview of the warung picked on /map, shared by the phone bottom sheet and
 * the desktop side panel. Best data first: the nearby list entry (with menus),
 * then the nationwide pin, then the radius pin.
 */
import Link from "next/link";
import { BadgeCheckIcon, MoonStarIcon, StoreIcon, UtensilsCrossedIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { localTimeZone } from "@/lib/campuses";
import type { BatchCard, MapPin, MerchantSummary, WarungMapPin } from "@/lib/contracts";
import { NO_TRUST_SIGNALS } from "@/lib/trust-signals";
import { cn } from "@/lib/utils";
import { RatingLine } from "../bits";
import { FoodThumb } from "../food-thumb";
import { MerchantCard } from "../merchant-card";
import { merchantCardFromWarungPin, previewIsIdle, previewSlug, type PreviewSources } from "./map-scope";

/** Card data for a radius pin whose warung is not (yet) in the nearby list. */
export function merchantFromPin(pin: MapPin) {
  return {
    slug: pin.slug,
    name: pin.merchant_name,
    category: "MAKANAN_BERAT" as const,
    address: "",
    distance_m: pin.distance_m,
    is_verified: pin.is_verified,
    rating_avg: 0,
    total_reviews: 0,
    // A radius pin carries no review signals; nothing is claimed until the warung loads.
    trust: NO_TRUST_SIGNALS,
    logo_url: null,
    max_discount_pct: pin.max_discount_pct,
    min_price_idr: 0,
    total_available_stock: pin.total_available_stock,
    closes_at: pin.pickup_end_time,
  };
}

/** Available menus of the previewed warung; each opens quick order. */
export function PreviewBatches({
  merchant,
  layout,
  onPick,
}: {
  merchant: MerchantSummary;
  layout: "row" | "grid";
  onPick: (batch: BatchCard) => void;
}) {
  const batches = merchant.batches.filter((b) => b.available_stock > 0);
  if (batches.length === 0) return null;
  return (
    <ul className={layout === "row" ? "no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4" : "mt-3 grid grid-cols-2 gap-2"}>
      {batches.map((b) => (
        <li key={b.batch_id} className={cn(layout === "row" && "w-40 shrink-0")}>
          <button
            type="button"
            onClick={() => onPick(b)}
            className="w-full rounded-2xl bg-muted/70 p-3 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
            aria-label={`Pesan ${b.menu_name}`}
          >
            <p className="line-clamp-1 text-xs font-semibold">{b.menu_name}</p>
            <p className="mt-1 text-sm font-extrabold tabular-nums">
              Rp {b.selling_price_idr.toLocaleString("id-ID")}{" "}
              <span className="text-[11px] font-semibold text-deal">-{b.discount_pct}%</span>
            </p>
            <p className="text-[11px] text-muted-foreground">Sisa {b.available_stock} porsi</p>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A warung on the map without live surplus right now. */
export function IdleWarungPreview({ warung }: { warung: WarungMapPin }) {
  return (
    <div className="flex gap-3">
      <FoodThumb
        category={warung.category}
        alt=""
        className="size-20 shrink-0 rounded-2xl grayscale"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <h3 className="truncate text-[15px] font-semibold">{warung.merchant_name}</h3>
          {warung.is_verified && (
            // Static icon, not the tooltip badge: the sheet focuses its first control on open.
            <BadgeCheckIcon className="size-4 shrink-0 text-brand-strong" aria-label="Mitra Terverifikasi" role="img" />
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <RatingLine avg={warung.rating_avg} count={warung.total_reviews} />
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          <MoonStarIcon className="size-3.5" aria-hidden />
          {warung.is_open ? "Belum ada surplus saat ini" : "Warung sedang tutup"}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Porsi surplus biasanya dibuka sekitar 20.00 {localTimeZone(warung)}. Ketuk &ldquo;Ingatkan&rdquo; di halaman
          warung supaya kamu dikabari.
        </p>
      </div>
    </div>
  );
}

/** Card + menus + CTA for the picked warung. */
export function WarungPreview({
  sources,
  layout,
  onPick,
}: {
  sources: PreviewSources;
  /** "row": phone sheet (scrolling menus, big CTA); "grid": desktop panel. */
  layout: "row" | "grid";
  onPick: (merchant: MerchantSummary, batch: BatchCard) => void;
}) {
  const { merchant, warung, pin } = sources;
  const slug = previewSlug(sources);
  const idle = previewIsIdle(sources);
  return (
    <>
      {merchant ? (
        <MerchantCard merchant={merchant} variant="sheet" />
      ) : idle && warung ? (
        <IdleWarungPreview warung={warung} />
      ) : warung ? (
        <MerchantCard merchant={merchantCardFromWarungPin(warung)} variant="sheet" />
      ) : pin ? (
        <MerchantCard merchant={merchantFromPin(pin)} variant="sheet" />
      ) : null}
      {merchant && <PreviewBatches merchant={merchant} layout={layout} onPick={(b) => onPick(merchant, b)} />}
      {slug && (
        <Button
          asChild
          variant={idle ? "outline" : "default"}
          className={cn("w-full rounded-full font-semibold", layout === "row" ? "mt-4 h-12 text-base" : "mt-3 h-11")}
        >
          <Link href={`/warung/${slug}`}>
            {idle ? <StoreIcon className="size-4" /> : <UtensilsCrossedIcon className="size-4" />}
            {idle ? "Lihat warung" : "Lihat menu & pesan"}
          </Link>
        </Button>
      )}
    </>
  );
}
