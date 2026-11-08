"use client";

/**
 * QuickOrderSheet — step 2 of the ≤ 3-step quick order (dev guide §7):
 * /discover → tap a menu card → "Pesan & Ambil Sendiri" → QRIS on /orders/<id>.
 *
 *   const { openQuickOrder, sheet } = useQuickOrder(batches);
 *   <DealTile batch={b} onOpenDetail={() => openQuickOrder(b)} … /> {sheet}
 *
 * Quick order checks out one batch directly (QRIS, pickup "Secepatnya") and
 * never touches the cart; "Tambah ke Keranjang" goes through useAddToCart so
 * the single-merchant DiffMerchantDialog guard still applies.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FootprintsIcon,
  HandPlatterIcon,
  Loader2Icon,
  QrCodeIcon,
  ShoppingBagIcon,
  SparklesIcon,
  SproutIcon,
  StoreIcon,
} from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { useAddToCart } from "@/components/common/diff-merchant-dialog";
import { DiscountBadge } from "@/components/common/discount-badge";
import { PriceTag } from "@/components/common/price-tag";
import { StockBadge } from "@/components/common/stock-badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerTitle } from "@/components/ui/drawer";
import { useCountdown } from "@/hooks/use-countdown";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import type { BatchCard, CheckoutResponse } from "@/lib/contracts";
import { co2GramsFromFoodGrams, formatKg } from "@/lib/impact";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { QtyStepper } from "../bits";
import { FoodThumb } from "../food-thumb";
import { formatDistance } from "../lib/format";
import { cartItemFromBatch, cartMerchantFromBatch, customerKeys } from "../lib/queries";
import { previewTotals, unpaidOrderHref } from "../lib/checkout-logic";
import { clampQuickOrderQty, quickOrderBody, quickOrderError, quickOrderLoginUrl, quickOrderMaxQty } from "./quick-order-logic";

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
  // (and an enabled "Pesan & Ambil Sendiri" that would create a 2nd order).
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
      <Drawer open={open && batch !== null} onOpenChange={onOpenChange}>
        <DrawerContent
          className="mx-auto max-w-md rounded-t-3xl"
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
              onAddToCart={(qty) => {
                // Close first so the DiffMerchantDialog (if any) is not under the drawer.
                onOpenChange(false);
                addToCart(cartMerchantFromBatch(batch), cartItemFromBatch(batch, qty));
              }}
            />
          )}
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
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
  onAddToCart: (qty: number) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const countdown = useCountdown(batch.pickup_end_time);
  const [rawQty, setQty] = useState(1);
  const qty = clampQuickOrderQty(rawQty, batch.available_stock);
  const max = quickOrderMaxQty(batch.available_stock);

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
  });
  const foodGrams = qty * batch.portion_weight_grams;

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
    mutationFn: () => api.post<CheckoutResponse>("/orders/checkout", quickOrderBody(batch, qty)),
    onSuccess: ({ order }) => {
      qc.setQueryData(customerKeys.order(order.id), { order });
      void qc.invalidateQueries({ queryKey: customerKeys.ordersAll });
      refreshLists();
      // Close before navigating: Back must not land on a still-open sheet
      // whose CTA would place a duplicate PENDING_PAYMENT order.
      onClose();
      router.push(`/orders/${order.id}`);
      toast.success("Stok dikunci 10 menit. Scan QRIS untuk bayar.", { id: "qo-ok" });
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
        default: {
          // Fair-use limit: an unpaid order is already waiting — offer to open it.
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
      <div className="overflow-y-auto px-4 pt-2">
        <div className="flex gap-3">
          <FoodThumb
            category={batch.category}
            imageUrl={batch.image_url}
            mystery={batch.is_mystery_bag}
            alt={batch.menu_name}
            className={cn("size-28 shrink-0 rounded-2xl", blocked && "grayscale")}
            iconClassName="size-10"
          />
          <div className="min-w-0 flex-1">
            <DiscountBadge pct={batch.discount_pct} endIso={batch.pickup_end_time} />
            <DrawerTitle className="mt-1.5 line-clamp-2 text-lg leading-snug font-extrabold">{batch.menu_name}</DrawerTitle>
            <DrawerDescription className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <StoreIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {batch.merchant_name}
                {batch.distance_m !== null && ` · ${formatDistance(batch.distance_m)}`}
              </span>
            </DrawerDescription>
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

        {batch.is_mystery_bag ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
            <SparklesIcon className="size-3.5" aria-hidden /> Paket kejutan — isi pilihan warung
          </p>
        ) : (
          batch.description && <p className="mt-3 text-sm leading-relaxed text-foreground/80">{batch.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <StockBadge available={batch.available_stock} />
          {!soldOut && <CountdownBadge endIso={batch.pickup_end_time} />}
        </div>

        <p className="mt-3 flex items-center gap-1.5 rounded-2xl bg-brand-soft/70 px-3 py-2.5 text-xs font-semibold text-secondary-foreground">
          <SproutIcon className="size-4 shrink-0 text-primary" aria-hidden />
          Selamatkan {foodGrams.toLocaleString("id-ID")} g pangan • −{formatKg(co2GramsFromFoodGrams(foodGrams))} CO₂e
        </p>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-muted/70 p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-bold">
              <HandPlatterIcon className="size-4 text-deal" aria-hidden /> Ambil Sendiri di Warung
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <FootprintsIcon className="size-3.5 shrink-0" aria-hidden />
              Secepatnya · s/d {formatClockId(batch.pickup_end_time)} WIB
            </p>
          </div>
          {!blocked && (
            <QtyStepper value={qty} min={1} max={max} onChange={setQty} label={batch.menu_name} size="sm" />
          )}
        </div>

        {!blocked && (
          <div className="mt-3 flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">
              Total bayar <span className="text-xs">(termasuk biaya layanan {formatIdr(totals.service_fee_idr)})</span>
            </span>
            <span className="font-extrabold tabular-nums">{formatIdr(totals.total_idr)}</span>
          </div>
        )}
      </div>

      <DrawerFooter className="gap-2 pt-3 pb-5">
        <Button
          ref={ctaRef}
          className="h-12 w-full rounded-full text-base font-bold shadow-soft"
          disabled={blocked || checkout.isPending || session.isLoading}
          onClick={order}
        >
          {checkout.isPending ? (
            <Loader2Icon className="size-5 animate-spin" aria-hidden />
          ) : (
            <QrCodeIcon className="size-5" aria-hidden />
          )}
          {blocked ? blockedLabel : checkout.isPending ? "Mengunci stok…" : "Pesan & Ambil Sendiri"}
        </Button>
        {!blocked && (
          <Button
            variant="outline"
            className="h-11 w-full rounded-full font-bold"
            disabled={checkout.isPending}
            onClick={() => onAddToCart(qty)}
          >
            <ShoppingBagIcon className="size-4" aria-hidden /> Tambah ke Keranjang
          </Button>
        )}
      </DrawerFooter>
    </>
  );
}
