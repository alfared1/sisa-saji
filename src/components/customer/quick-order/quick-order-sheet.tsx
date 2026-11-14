"use client";

/**
 * QuickOrderSheet: step 2 of the ≤ 3-step quick order (docs/ARCHITECTURE.md, Konvensi UI):
 * /discover → tap a menu card → "Kunci Porsi Sekarang" → QRIS on /orders/<id>, or straight
 * to the pickup ticket when the buyer pays cash at the warung.
 *
 *   const { openQuickOrder, sheet } = useQuickOrder(batches);
 *   <DealTile batch={b} onOpenDetail={() => openQuickOrder(b)} … /> {sheet}
 *
 * Quick order checks out one batch directly (pickup "Secepatnya", the chosen lauk and
 * payment) and never touches the cart; "Tambah ke Keranjang" goes through useAddToCart so
 * the single-merchant DiffMerchantDialog guard still applies.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HandPlatterIcon, Loader2Icon, LockIcon, StarIcon, StoreIcon } from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { useAddToCart } from "@/components/common/diff-merchant-dialog";
import { DiscountBadge } from "@/components/common/discount-badge";
import { ImpactLine } from "@/components/common/impact-line";
import { LaukPicker } from "@/components/common/lauk-picker";
import { LaukSummary } from "@/components/common/lauk-summary";
import { PhotoBadge } from "@/components/common/photo-badge";
import { PriceTag } from "@/components/common/price-tag";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetDescription,
  ResponsiveSheetFooter,
  ResponsiveSheetTitle,
  useResponsiveSheetVariant,
} from "@/components/common/responsive-sheet";
import { StockBadge } from "@/components/common/stock-badge";
import { TrustBadges } from "@/components/common/trust-badges";
import { Button } from "@/components/ui/button";
import { useCountdown } from "@/hooks/use-countdown";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import type { BatchCard, CheckoutResponse, MerchantDetail, NearbyResponse } from "@/lib/contracts";
import { defaultLauk, findItem } from "@/lib/lauk";
import { formatClockId, formatIdr } from "@/lib/time";
import { ratingText } from "@/lib/trust-signals";
import { cn } from "@/lib/utils";
import { useLocationStore } from "@/stores/location";
import { QtyStepper } from "../bits";
import { FoodThumb } from "../food-thumb";
import { distanceLine } from "../lib/format";
import { cartItemFromBatch, cartMerchantFromBatch, customerKeys } from "../lib/queries";
import { holdNoteText, lockedToastText, previewTotals, unpaidOrderHref } from "../lib/checkout-logic";
import {
  clampQuickOrderQty,
  quickOrderBody,
  quickOrderError,
  quickOrderIsCash,
  quickOrderLoginUrl,
  quickOrderMaxQty,
  type QuickPayMethod,
} from "./quick-order-logic";

export type QuickOrderOptions = {
  /** When set, ordering is disabled with this label (e.g. warung tutup). */
  disabledLabel?: string;
};

/**
 * Owns the sheet state. Pass the screen's current batches so the open sheet
 * follows live price / stock updates (SSE patches the query cache).
 */
export function useQuickOrder(batches?: readonly BatchCard[]): {
  openQuickOrder: (batch: BatchCard, opts?: QuickOrderOptions) => void;
  sheet: ReactNode;
} {
  const [snapshot, setSnapshot] = useState<BatchCard | null>(null);
  const [opts, setOpts] = useState<QuickOrderOptions>({});
  const [open, setOpen] = useState(false);

  const openQuickOrder = useCallback((batch: BatchCard, o: QuickOrderOptions = {}) => {
    setSnapshot(batch);
    setOpts(o);
    setOpen(true);
  }, []);

  // Next 16 (Cache Components) keeps a visited route alive as a hidden
  // <Activity>; its effects are torn down while hidden. Closing here means a
  // route the user comes Back to never re-appears with an open order sheet
  // (and an enabled "Kunci Porsi Sekarang" that would create a 2nd order).
  useEffect(
    () => () => {
      setOpen(false);
      setSnapshot(null);
    },
    [],
  );

  const live = snapshot ? (batches?.find((b) => b.batch_id === snapshot.batch_id) ?? snapshot) : null;
  const sheet = (
    <QuickOrderSheet batch={live} open={open} onOpenChange={setOpen} disabledLabel={opts.disabledLabel} />
  );
  return { openQuickOrder, sheet };
}

export function QuickOrderSheet({
  batch,
  open,
  onOpenChange,
  disabledLabel,
}: {
  batch: BatchCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabledLabel?: string;
}) {
  const { addToCart, dialog } = useAddToCart();
  const ctaRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      {/* Phones: bottom drawer. lg+ (≥ 1024px): centred dialog. Both are role=dialog named by the menu title. */}
      <ResponsiveSheet open={open && batch !== null} onOpenChange={onOpenChange}>
        <ResponsiveSheetContent
          className="mx-auto max-w-md rounded-t-3xl"
          dialogClassName="sm:max-w-[600px]"
          onOpenAutoFocus={(e) => {
            // Start keyboard / screen-reader users on the primary action.
            const cta = ctaRef.current;
            if (cta && !cta.disabled) {
              e.preventDefault();
              cta.focus();
            }
          }}
        >
          {batch && (
            <QuickOrderBody
              key={batch.batch_id}
              batch={batch}
              disabledLabel={disabledLabel}
              ctaRef={ctaRef}
              onClose={() => onOpenChange(false)}
              onAddToCart={(qty, lauk) => {
                // Close first so the DiffMerchantDialog (if any) is not under the drawer.
                onOpenChange(false);
                addToCart(cartMerchantFromBatch(batch), cartItemFromBatch(batch, qty, lauk));
              }}
            />
          )}
        </ResponsiveSheetContent>
      </ResponsiveSheet>
      {dialog}
    </>
  );
}

/**
 * The warung's star rating, read from data this screen already loaded (the warung page or
 * the nearby list). A BatchCard carries no rating, and the sheet does not fetch one: when
 * neither cache has the warung, no rating is shown.
 */
function cachedRating(qc: QueryClient, batch: BatchCard): { avg: number; count: number } | null {
  const detail = qc.getQueryData<MerchantDetail>(customerKeys.warung(batch.merchant_slug));
  if (detail && detail.id === batch.merchant_id) return { avg: detail.rating_avg, count: detail.total_reviews };
  for (const [, data] of qc.getQueriesData<NearbyResponse>({ queryKey: customerKeys.nearbyAll })) {
    const m = data?.merchants?.find((x) => x.id === batch.merchant_id);
    if (m) return { avg: m.rating_avg, count: m.total_reviews };
  }
  return null;
}

const PAY_CHOICES: { key: QuickPayMethod; label: string }[] = [
  { key: "QRIS", label: "QRIS Instan" },
  { key: "BAYAR_DI_WARUNG", label: "Tunai di warung" },
];

/** Two-way payment switch: a radiogroup "Cara bayar" (arrow keys move the choice). */
function PayChoice({ value, onChange }: { value: QuickPayMethod; onChange: (m: QuickPayMethod) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number) => {
    const next = (from + 1) % PAY_CHOICES.length;
    onChange(PAY_CHOICES[next].key);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Cara bayar" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
      {PAY_CHOICES.map((c, i) => {
        const checked = value === c.key;
        return (
          <button
            key={c.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(c.key)}
            onKeyDown={(e) => {
              if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) {
                e.preventDefault();
                move(i);
              }
            }}
            className={cn(
              "h-10 rounded-lg text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              checked ? "bg-card text-foreground shadow-soft ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

function QuickOrderBody({
  batch,
  disabledLabel,
  ctaRef,
  onClose,
  onAddToCart,
}: {
  batch: BatchCard;
  disabledLabel?: string;
  ctaRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onAddToCart: (qty: number, lauk: string | null) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const desktop = useResponsiveSheetVariant() === "dialog";
  const countdown = useCountdown(batch.pickup_end_time);
  const originSource = useLocationStore((s) => s.source);
  const originLabel = useLocationStore((s) => s.label);
  const [rawQty, setQty] = useState(1);
  const [method, setMethod] = useState<QuickPayMethod>("QRIS");
  const [rawLauk, setLauk] = useState<string | null>(() => defaultLauk(batch));
  const [photoFailed, setPhotoFailed] = useState(false);

  const pilot = Boolean(batch.merchant_is_pilot);
  const cash = quickOrderIsCash(batch, method);
  const qty = clampQuickOrderQty(rawQty, batch.available_stock, cash);
  const max = quickOrderMaxQty(batch.available_stock, cash);
  // A chosen lauk that ran out meanwhile (live update) falls back to the first one left.
  const lauk = (rawLauk !== null ? findItem(batch.lauk_available, rawLauk) : null) ?? defaultLauk(batch);

  const soldOut = batch.available_stock <= 0;
  const closed = countdown.ready && countdown.isOver;
  const blockedLabel = soldOut ? "Habis" : closed ? "Sudah tutup" : disabledLabel;
  const blocked = Boolean(blockedLabel);

  const totals = previewTotals({
    items: [
      {
        quantity: qty,
        unit_price_idr: batch.selling_price_idr,
        original_price_idr: batch.original_price_idr,
        portion_weight_grams: batch.portion_weight_grams,
      },
    ],
    voucher: null,
    method: cash ? "BAYAR_DI_WARUNG" : "QRIS",
  });
  const foodGrams = qty * batch.portion_weight_grams;
  const rating = cachedRating(qc, batch);
  const distance = distanceLine(batch.distance_m, { source: originSource, label: originLabel }, "long");
  const showDescription = batch.contents.length === 0 && batch.lauk_options.length === 0 && Boolean(batch.description);

  const refreshLists = () => {
    void qc.invalidateQueries({ queryKey: customerKeys.warungAll });
    void qc.invalidateQueries({ queryKey: customerKeys.nearbyAll });
    void qc.invalidateQueries({ queryKey: customerKeys.pinsAll });
  };

  const goLogin = () => {
    toast.message("Masuk dulu untuk memesan", {
      id: "qo-login",
      description: "Setelah masuk, menu ini langsung terbuka lagi.",
    });
    router.push(quickOrderLoginUrl(batch.merchant_slug, batch.batch_id));
  };

  const checkout = useMutation({
    mutationFn: () => api.post<CheckoutResponse>("/orders/checkout", quickOrderBody(batch, qty, { method, lauk })),
    onSuccess: ({ order }) => {
      qc.setQueryData(customerKeys.order(order.id), { order });
      void qc.invalidateQueries({ queryKey: customerKeys.ordersAll });
      refreshLists();
      // Close before navigating: Back must not land on a still-open sheet
      // whose CTA would place a duplicate order.
      onClose();
      router.push(`/orders/${order.id}`);
      toast.success(lockedToastText(order.payment_method === "BAYAR_DI_WARUNG"), { id: "qo-ok" });
    },
    onError: (err) => {
      if (!(err instanceof ApiClientError)) {
        toast.error("Gagal membuat pesanan. Coba lagi.");
        return;
      }
      const e = quickOrderError(err.code, err.message, err.details, batch.menu_name);
      switch (e.kind) {
        case "login":
          goLogin();
          return;
        case "stock":
          toast.error(e.title, { description: e.description });
          if (e.available !== null && e.available > 0) setQty(e.available);
          else onClose();
          refreshLists();
          return;
        case "closed":
          toast.error(e.title, { description: e.description });
          onClose();
          refreshLists();
          return;
        case "lauk":
          // Keep the sheet open on tonight's remaining lauk; the list refetch brings the batch up to date.
          toast.error(e.title, { description: e.description });
          setLauk(e.lauk_available[0] ?? null);
          refreshLists();
          return;
        default: {
          // Fair-use limit: an unpaid order is already waiting, so offer to open it.
          const href = unpaidOrderHref(err.code, err.details);
          if (href) {
            toast.error(err.message, {
              action: {
                label: "Lihat pesanan",
                onClick: () => {
                  onClose();
                  router.push(href);
                },
              },
            });
            return;
          }
          toast.error(e.title, { description: e.description });
        }
      }
    },
  });

  const order = () => {
    if (blocked || checkout.isPending) return;
    if (!session.user) {
      goLogin();
      return;
    }
    checkout.mutate();
  };

  return (
    <>
      <div className={cn("overflow-y-auto px-4 pt-2", desktop && "min-h-0 flex-1 px-6 pt-6")}>
        <div className={cn("flex gap-3", desktop && "gap-5")}>
          <FoodThumb
            category={batch.category}
            imageUrl={batch.image_url}
            photo={batch.photo}
            onPhotoError={() => setPhotoFailed(true)}
            alt={batch.menu_name}
            className={cn("size-28 shrink-0 rounded-2xl", desktop && "size-44 rounded-3xl", blocked && "grayscale")}
            noPhotoLabel
          />
          {/* Dialog: right padding keeps the badge / title clear of the close button. */}
          <div className={cn("min-w-0 flex-1", desktop && "pt-1 pr-8")}>
            <DiscountBadge pct={batch.discount_pct} endIso={batch.pickup_end_time} />
            <ResponsiveSheetTitle
              className={cn("mt-1.5 line-clamp-2 text-lg leading-snug font-bold", desktop && "mt-2 text-xl")}
            >
              {batch.menu_name}
            </ResponsiveSheetTitle>
            <ResponsiveSheetDescription className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
              <StoreIcon className="mt-px size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                {batch.merchant_name}
                {distance && ` · ${distance}`}
              </span>
            </ResponsiveSheetDescription>
            <PriceTag
              original={batch.original_price_idr}
              selling={batch.selling_price_idr}
              discountPct={batch.discount_pct}
              showBadge={false}
              size="lg"
              className="mt-2"
            />
          </div>
        </div>

        {batch.photo && !photoFailed && <PhotoBadge photo={batch.photo} variant="line" className="mt-2" />}

        {(rating || batch.merchant_trust.hygiene || batch.merchant_trust.portion_full) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {rating && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground/80 tabular-nums">
                {rating.count > 0 && <StarIcon className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />}
                {ratingText(rating.avg, rating.count, "long")}
              </span>
            )}
            {/* A smaller portion tonight is said in full below, so no review-based portion chip then. */}
            <TrustBadges trust={batch.merchant_trust} variant="short" only={batch.full_portion ? undefined : "hygiene"} />
          </div>
        )}

        <LaukSummary batch={batch} lines="full" className="mt-3 text-sm" />
        {showDescription && <p className="mt-3 text-sm leading-relaxed text-foreground/80">{batch.description}</p>}

        {!blocked && <LaukPicker batch={batch} value={lauk} onChange={setLauk} className="mt-3" />}

        <p className={cn("mt-3 text-sm", batch.full_portion ? "text-muted-foreground" : "font-semibold text-foreground")}>
          {batch.full_portion ? "Janji warung: porsi sama dengan porsi normal." : "Porsi malam ini lebih kecil dari biasa."}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <StockBadge available={batch.available_stock} />
          {!soldOut && <CountdownBadge endIso={batch.pickup_end_time} />}
        </div>

        <ImpactLine
          foodGrams={foodGrams}
          className="mt-3 rounded-2xl bg-brand-soft/70 px-3 py-2.5 text-xs text-secondary-foreground"
        />

        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-muted/70 p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-semibold">
              <HandPlatterIcon className="size-4 shrink-0 text-primary" aria-hidden /> Ambil sendiri ke warung
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Rp 0 · s/d {formatClockId(batch.pickup_end_time)} WIB
            </p>
          </div>
          {!blocked && (
            <QtyStepper value={qty} min={1} max={max} onChange={setQty} label={batch.menu_name} size="sm" />
          )}
        </div>

        {!blocked && (
          <div className="mt-3 space-y-2">
            {pilot ? (
              <p className="text-sm font-semibold">
                Bayar tunai di warung{" "}
                <span className="text-xs font-normal text-muted-foreground">(warung uji coba, tanpa biaya layanan)</span>
              </p>
            ) : (
              <PayChoice value={method} onChange={setMethod} />
            )}
            {cash ? (
              <p className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Bayar di warung saat ambil <span className="text-xs">(tanpa biaya layanan)</span>
                </span>
                <span className="shrink-0 font-extrabold whitespace-nowrap tabular-nums">{formatIdr(totals.total_idr)}</span>
              </p>
            ) : (
              <p className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Total bayar <span className="text-xs">(termasuk biaya layanan {formatIdr(totals.service_fee_idr)})</span>
                </span>
                <span className="shrink-0 font-extrabold whitespace-nowrap tabular-nums">{formatIdr(totals.total_idr)}</span>
              </p>
            )}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <LockIcon className="mt-px size-3 shrink-0" aria-hidden /> {holdNoteText(cash)}
            </p>
          </div>
        )}
      </div>

      <ResponsiveSheetFooter className={cn("gap-2 pt-3 pb-5", desktop && "flex-row px-6 pt-4 pb-6 *:flex-1")}>
        <Button
          ref={ctaRef}
          className="h-12 w-full rounded-xl text-base font-semibold shadow-soft"
          disabled={blocked || checkout.isPending || session.isLoading}
          onClick={order}
        >
          {checkout.isPending ? (
            <Loader2Icon className="size-5 animate-spin" aria-hidden />
          ) : (
            <LockIcon className="size-5" aria-hidden />
          )}
          {blocked ? blockedLabel : checkout.isPending ? "Mengunci porsi…" : "Kunci Porsi Sekarang"}
        </Button>
        {!blocked && (
          <Button
            variant="outline"
            className={cn("h-11 w-full rounded-xl font-semibold", desktop && "h-12")}
            disabled={checkout.isPending}
            onClick={() => onAddToCart(qty, lauk)}
          >
            Tambah ke Keranjang
          </Button>
        )}
      </ResponsiveSheetFooter>
    </>
  );
}
