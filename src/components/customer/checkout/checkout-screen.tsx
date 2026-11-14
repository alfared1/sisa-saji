"use client";

/**
 * /checkout — CheckoutScreen + PaymentScreen entry: cart lines with steppers and lauk,
 * pickup options (self-pickup only; collective delivery is a waiting list), pickup slot,
 * own container, payment method (QRIS, cash at the warung, GoPay, DANA), voucher,
 * price & impact breakdown → POST /orders/checkout ("Kunci Porsi Sekarang") → /orders/[id].
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { Loader2Icon, LockIcon, ShoppingBagIcon, StoreIcon, Trash2Icon, WalletIcon } from "lucide-react";
import { DiscountBadge } from "@/components/common/discount-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ImpactLine } from "@/components/common/impact-line";
import { LaukPicker } from "@/components/common/lauk-picker";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { Money } from "@/components/common/money";
import { PageHeader } from "@/components/common/page-header";
import { AppSplash } from "@/components/shell/app-splash";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import type {
  CheckoutBody,
  CheckoutPaymentChoice,
  CheckoutResponse,
  MerchantDetail,
  VouchersResponse,
} from "@/lib/contracts";
import { PAY_AT_WARUNG_MAX_PORTIONS } from "@/lib/constants";
import { findItem, laukNoun } from "@/lib/lauk";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { selectCartCount, selectCartEarliestEnd, useCartStore, type CartItem } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { useLocationStore } from "@/stores/location";
import { QtyStepper } from "../bits";
import { useBatchStream } from "../hooks/use-batch-stream";
import {
  cartLineMax,
  checkoutErrorAction,
  effectivePaymentMethod,
  holdNoteText,
  isCashPayment,
  laukUnavailable,
  lockedToastText,
  perBuyerCaps,
  previewTotals,
  ticketLineMax,
  trimToTicketCap,
  unpaidOrderHref,
} from "../lib/checkout-logic";
import { generatePickupSlots, pickupEndIso } from "../lib/pickup-slots";
import { cartPatchFromBatch, customerKeys } from "../lib/queries";
import {
  BringOwnContainerToggle,
  CheckoutCard,
  PaymentMethodPicker,
  PickupOptionsCard,
  PickupTimeSlotSelector,
  PriceAndImpactBreakdown,
  VoucherRow,
  VoucherSelectorSheet,
} from "./checkout-parts";

type LineState = "ok" | "soldout" | "gone";

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function CheckoutScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const hydrated = useStoresHydrated();
  const now = useNow(30_000);
  const { merchant, items } = useCartStore(useShallow((s) => ({ merchant: s.merchant, items: s.items })));
  const earliestEnd = useCartStore(selectCartEarliestEnd);
  const portions = useCartStore(selectCartCount);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const setLauk = useCartStore((s) => s.setLauk);
  const patchBatch = useCartStore((s) => s.patchBatch);
  const clearCart = useCartStore((s) => s.clear);
  const userLat = useLocationStore((s) => s.lat);
  const userLng = useLocationStore((s) => s.lng);

  const [slot, setSlot] = useState<string | null>(null);
  const [ownContainer, setOwnContainer] = useState(false);
  const [method, setMethod] = useState<CheckoutPaymentChoice>("QRIS");
  const [voucherCode, setVoucherCode] = useState<string | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const succeeded = useRef(false);

  // ---- auth gate ----
  const needsLogin = hydrated && !session.isLoading && !session.user && items.length > 0;
  useEffect(() => {
    if (needsLogin && !succeeded.current) {
      toast.message("Masuk dulu untuk lanjut bayar", { id: "checkout-login" });
      router.replace("/auth/login?next=%2Fcheckout");
    }
  }, [needsLogin, router]);

  // ---- live merchant data (fresh prices / stock / lauk for the cart lines) ----
  const detail = useQuery({
    queryKey: customerKeys.warung(merchant?.slug ?? "-"),
    queryFn: () => api.get<MerchantDetail>(`/merchants/${encodeURIComponent(merchant?.slug ?? "")}`, { lat: userLat, lng: userLng }),
    enabled: hydrated && Boolean(merchant),
    staleTime: 10_000,
  });
  useBatchStream({
    lat: detail.data?.lat ?? 0,
    lng: detail.data?.lng ?? 0,
    radiusM: 300,
    enabled: Boolean(detail.data),
  });

  // Sync cart prices / stock caps / tonight's lauk with the latest batch data (once per batch:
  // patchBatch updates every line of it).
  useEffect(() => {
    if (!detail.data) return;
    const byId = new Map(detail.data.batches.map((b) => [b.batch_id, b]));
    const seen = new Set<string>();
    for (const it of useCartStore.getState().items) {
      if (seen.has(it.batch_id)) continue;
      seen.add(it.batch_id);
      const b = byId.get(it.batch_id);
      if (!b || b.available_stock <= 0) continue;
      const patch = { ...cartPatchFromBatch(b), category: b.category };
      if (
        patch.unit_price_idr !== it.unit_price_idr ||
        patch.discount_pct !== it.discount_pct ||
        patch.max_quantity !== it.max_quantity ||
        patch.category !== it.category ||
        !sameList(b.lauk_available, it.lauk_available)
      ) {
        patchBatch(it.batch_id, patch);
      }
    }
  }, [detail.data, patchBatch]);

  const lineState = useMemo(() => {
    const out = new Map<string, LineState>();
    if (!detail.data) return out;
    const byId = new Map(detail.data.batches.map((b) => [b.batch_id, b]));
    for (const it of items) {
      const b = byId.get(it.batch_id);
      const closed = b && now !== null && Date.parse(b.pickup_end_time) <= now;
      out.set(it.batch_id, !b || closed ? "gone" : b.available_stock <= 0 ? "soldout" : "ok");
    }
    return out;
  }, [detail.data, items, now]);
  const stateOf = (it: CartItem): LineState => lineState.get(it.batch_id) ?? "ok";
  /** The chosen lauk is no longer on tonight's list (only judged once fresh batch data is in). */
  const laukGone = (it: CartItem) =>
    Boolean(detail.data) && it.lauk !== null && findItem(it.lauk_available, it.lauk) === null;
  const unavailable = items.some((i) => stateOf(i) !== "ok");
  const laukMissing = items.some((i) => stateOf(i) === "ok" && laukGone(i));
  const blocked = unavailable || laukMissing;

  const vouchers = useQuery({
    queryKey: customerKeys.vouchers,
    queryFn: () => api.get<VouchersResponse>("/vouchers"),
    staleTime: 5 * 60_000,
  });
  // Cash ("bayar di warung", chosen here or forced at a pilot warung): no service fee, no
  // voucher, at most PAY_AT_WARUNG_MAX_PORTIONS, portions held PAY_AT_WARUNG_HOLD_MINUTES.
  const isPilot = detail.data?.is_pilot ?? false;
  const cash = isCashPayment(isPilot, method);
  const payMethod = effectivePaymentMethod(isPilot, method);
  const voucher = cash ? null : (vouchers.data?.vouchers.find((v) => v.code === voucherCode) ?? null);
  const preview = previewTotals({ items, voucher, method: payMethod });
  const holdNote = holdNoteText(cash);
  const cashDisabledReason =
    !cash && portions > PAY_AT_WARUNG_MAX_PORTIONS ? `Maksimal ${PAY_AT_WARUNG_MAX_PORTIONS} porsi untuk bayar tunai` : null;

  const changeMethod = (m: CheckoutPaymentChoice) => {
    setMethod(m);
    if (m === "BAYAR_DI_WARUNG") setVoucherCode(null);
  };

  // A "bayar di warung" ticket holds at most PAY_AT_WARUNG_MAX_PORTIONS portions (server rule):
  // bring a bigger cart down before the buyer presses the button.
  useEffect(() => {
    if (!cash) return;
    const cut = trimToTicketCap(useCartStore.getState().items, PAY_AT_WARUNG_MAX_PORTIONS);
    for (const c of cut) {
      if (c.quantity <= 0) removeItem(c.key);
      else setQuantity(c.key, c.quantity);
    }
    if (cut.length) {
      toast(`Satu tiket bayar di warung paling banyak ${PAY_AT_WARUNG_MAX_PORTIONS} porsi`, {
        id: "ticket-cap",
        description: "Jumlah porsi di keranjang sudah disesuaikan.",
      });
    }
  }, [cash, items, removeItem, setQuantity]);

  const endIso = now === null ? null : pickupEndIso({ nowMs: now, earliestEndIso: earliestEnd, cash });
  const slots = useMemo(
    () =>
      now === null
        ? []
        : generatePickupSlots({
            nowMs: now,
            endIso,
            startIso: detail.data?.batches
              .filter((b) => items.some((i) => i.batch_id === b.batch_id))
              .map((b) => b.pickup_start_time)
              .sort()
              .at(-1),
          }),
    [now, endIso, detail.data, items],
  );
  // Drop a chosen slot that is no longer offered.
  const slotValid = slot === null || slots.some((s) => s.iso === slot);

  const removeBatch = (batchId: string) => {
    for (const line of useCartStore.getState().items) if (line.batch_id === batchId) removeItem(line.key);
  };

  const checkout = useMutation({
    mutationFn: (body: CheckoutBody) => api.post<CheckoutResponse>("/orders/checkout", body),
    onSuccess: ({ order }) => {
      succeeded.current = true;
      qc.setQueryData(customerKeys.order(order.id), { order });
      void qc.invalidateQueries({ queryKey: customerKeys.ordersAll });
      void qc.invalidateQueries({ queryKey: customerKeys.warungAll });
      void qc.invalidateQueries({ queryKey: customerKeys.nearbyAll });
      router.replace(`/orders/${order.id}`);
      clearCart();
      toast.success(lockedToastText(order.payment_method === "BAYAR_DI_WARUNG"), { id: "checkout-ok" });
    },
    onError: (err) => {
      if (!(err instanceof ApiClientError)) {
        toast.error("Gagal membuat pesanan. Coba lagi.");
        return;
      }
      // A chosen lauk ran out meanwhile: refresh tonight's list on those lines and let the buyer pick.
      const gone = laukUnavailable(err.code, err.details);
      if (gone.length) {
        for (const g of gone) patchBatch(g.batch_id, { lauk_available: g.lauk_available });
        toast.error(err.message, { description: "Pilih lauk lain di keranjang, lalu kunci lagi." });
        void detail.refetch();
        return;
      }
      const action = checkoutErrorAction(err.code, err.details);
      switch (action.kind) {
        case "stock": {
          if (action.batch_id && action.available !== null) {
            const line = items.find((i) => i.batch_id === action.batch_id);
            if (action.available <= 0) removeBatch(action.batch_id);
            else patchBatch(action.batch_id, { max_quantity: action.available });
            toast.error(
              action.available <= 0
                ? `${line?.menu_name ?? "Menu"} sudah habis dan dihapus dari keranjang.`
                : `Stok ${line?.menu_name ?? "menu"} tinggal ${action.available} porsi. Jumlahnya sudah disesuaikan.`,
            );
          } else toast.error(err.message);
          void detail.refetch();
          break;
        }
        case "closed":
          toast.error(err.message, { description: "Hapus menu yang sudah tutup atau pilih warung lain." });
          void detail.refetch();
          break;
        case "different_merchant":
          toast.error("Keranjang berisi menu dari warung berbeda. Keranjang dikosongkan.");
          clearCart();
          break;
        case "voucher":
          setVoucherCode(null);
          toast.error(err.message, { description: "Voucher dilepas. Kamu tetap bisa lanjut." });
          break;
        case "login":
          router.replace("/auth/login?next=%2Fcheckout");
          break;
        default: {
          // Fair-use limits (unpaid order waiting / per-buyer portion cap).
          const href = unpaidOrderHref(err.code, err.details);
          const caps = perBuyerCaps(err.code, err.details);
          if (href) {
            toast.error(err.message, { action: { label: "Lihat pesanan", onClick: () => router.push(href) } });
          } else if (caps.length) {
            for (const c of caps) patchBatch(c.batch_id, { max_quantity: c.max_quantity });
            toast.error(err.message, { description: "Jumlah porsi sudah disesuaikan dengan batas per pembeli." });
          } else {
            toast.error(err.message);
          }
        }
      }
    },
  });

  const submit = () => {
    if (!merchant || items.length === 0 || checkout.isPending || blocked) return;
    checkout.mutate({
      merchant_id: merchant.id,
      items: items.map((i) => ({ batch_id: i.batch_id, quantity: i.quantity, ...(i.lauk ? { lauk: i.lauk } : {}) })),
      scheduled_pickup_time: slot && slotValid ? slot : undefined,
      uses_own_lunchbox: ownContainer,
      payment_method: payMethod,
      voucher_code: voucher ? voucher.code : undefined,
    });
  };

  const changeQty = (item: CartItem, v: number) => {
    if (v <= 0) {
      removeItem(item.key);
      toast(`${item.menu_name} dihapus`, {
        id: `rm-${item.key}`,
        action: {
          label: "Urungkan",
          onClick: () => {
            const m = useCartStore.getState().merchant ?? merchant;
            if (m) useCartStore.getState().addItem(m, { ...item, quantity: 1 });
          },
        },
      });
    } else setQuantity(item.key, v);
  };

  /* ------------------------------- render ------------------------------- */

  if (!hydrated || (items.length > 0 && session.isLoading)) {
    return (
      <>
        <PageHeader title="Checkout" backHref="/discover" />
        <ListSkeleton className="px-4 pt-4" count={3} />
      </>
    );
  }
  if (needsLogin) return <AppSplash label="Mengalihkan ke halaman masuk…" />;
  if (items.length === 0 || !merchant) {
    if (checkout.isSuccess) return <AppSplash label="Membuka pesanan…" />;
    return (
      <>
        <PageHeader title="Checkout" backHref="/discover" />
        <EmptyState
          icon={ShoppingBagIcon}
          title="Keranjang masih kosong"
          description="Pilih menu dari warung terdekat, lalu kunci porsimu sebelum warung tutup."
          action={
            <Button asChild className="h-11 rounded-xl px-6 font-semibold">
              <Link href="/discover">Cari makanan</Link>
            </Button>
          }
        />
      </>
    );
  }

  const deadlineLabel = endIso ? formatClockId(endIso) : earliestEnd ? formatClockId(earliestEnd) : null;
  const blockedText = unavailable
    ? "Hapus menu yang tidak tersedia untuk lanjut."
    : "Pilih lauk lain untuk menu yang lauknya habis.";
  // Rendered twice: phone pay bar (lg:hidden) and the lg+ summary card (hidden lg:block).
  const payButton = (className: string) => (
    <Button
      className={cn("rounded-xl px-5 text-base font-semibold shadow-card", className)}
      onClick={submit}
      disabled={checkout.isPending || blocked || !detail.data}
    >
      {checkout.isPending ? <Loader2Icon className="size-5 animate-spin" aria-hidden /> : <LockIcon className="size-4" aria-hidden />}
      {checkout.isPending ? "Mengunci porsi…" : "Kunci Porsi Sekarang"}
    </Button>
  );
  const voucherRow = cash ? null : (
    <VoucherRow
      voucher={voucher}
      subtotal={preview.subtotal_recovery_idr}
      onOpen={() => setVoucherOpen(true)}
      onClear={() => setVoucherCode(null)}
    />
  );

  return (
    <>
      <PageHeader title="Checkout" subtitle={`Ambil di ${merchant.name}`} backHref={`/warung/${merchant.slug}`} />

      {/* lg+: two columns. Left = order details; right = sticky summary (breakdown, voucher, pay).
          Below lg both columns are `contents`, so phones keep the single stacked list in the same order. */}
      <div className="flex flex-col gap-3 px-4 pt-4 pb-44 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8 lg:pt-2 lg:pb-12 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          {/* ---------- Cart ---------- */}
          <CheckoutCard
            title="Pesananmu"
            icon={StoreIcon}
            action={
              <Link href={`/warung/${merchant.slug}`} className="text-xs font-semibold text-primary hover:underline">
                + Tambah menu
              </Link>
            }
          >
            <p className="-mt-1 mb-3 truncate text-xs text-muted-foreground">{merchant.name}</p>
            <ul className="divide-y divide-border">
              {items.map((it) => {
                const state = stateOf(it);
                const missing = state === "ok" && laukGone(it);
                const lineMax = cartLineMax(items, it.key, it.max_quantity);
                const noun = laukNoun(it.category);
                return (
                  <li key={it.key} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className={cn("line-clamp-2 text-sm font-semibold", state !== "ok" && "text-muted-foreground line-through")}>
                          {it.menu_name}
                        </p>
                        {it.lauk && (
                          <p className={cn("mt-0.5 text-xs", missing ? "text-urgent" : "text-muted-foreground")}>
                            <span className="font-semibold">{noun}:</span> {it.lauk}
                            {missing && " (habis)"}
                          </p>
                        )}
                        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
                          <span className="font-extrabold tabular-nums">{formatIdr(it.unit_price_idr)}</span>
                          <span className="text-muted-foreground line-through tabular-nums">{formatIdr(it.original_price_idr)}</span>
                          {state === "ok" && (
                            <DiscountBadge pct={it.discount_pct} endIso={it.pickup_end_time} size="sm" className="self-center" />
                          )}
                        </p>
                        {state === "ok" && (
                          <ImpactLine portionWeightGrams={it.portion_weight_grams} quantity={it.quantity} className="mt-1" />
                        )}
                        {state !== "ok" && (
                          <p className="mt-1 text-xs font-semibold text-urgent">
                            {state === "soldout" ? "Stok habis" : "Sudah tidak tersedia (warung tutup)"}
                          </p>
                        )}
                      </div>
                      {state === "ok" ? (
                        <QtyStepper
                          value={it.quantity}
                          min={0}
                          max={cash ? ticketLineMax(items, it.key, lineMax, PAY_AT_WARUNG_MAX_PORTIONS) : lineMax}
                          size="sm"
                          label={it.lauk ? `${it.menu_name}, ${it.lauk}` : it.menu_name}
                          onChange={(v) => changeQty(it, v)}
                        />
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-xl text-xs font-semibold text-urgent"
                          onClick={() => removeItem(it.key)}
                        >
                          <Trash2Icon className="size-3.5" aria-hidden /> Hapus
                        </Button>
                      )}
                    </div>
                    {state === "ok" && missing && (
                      <p className="mt-2 text-xs font-semibold text-urgent">
                        {it.lauk_available.length > 0
                          ? `${noun} ini sudah habis. Pilih yang lain.`
                          : `${noun} menu ini sudah habis semua. Hapus menu ini atau pilih saat ambil di warung.`}
                      </p>
                    )}
                    {state === "ok" && it.lauk_available.length > 1 && (
                      <LaukPicker
                        batch={it}
                        value={it.lauk}
                        onChange={(l) => setLauk(it.key, l)}
                        itemName={it.menu_name}
                        size="sm"
                        className="mt-2"
                      />
                    )}
                    {state === "ok" && missing && it.lauk_available.length === 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 h-9 rounded-xl text-xs font-semibold"
                        onClick={() => setLauk(it.key, it.lauk_available[0])}
                      >
                        Ganti ke {it.lauk_available[0]}
                      </Button>
                    )}
                    {state === "ok" && missing && it.lauk_available.length === 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 h-9 rounded-xl text-xs font-semibold"
                        onClick={() => setLauk(it.key, null)}
                      >
                        Pilih saat ambil
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            {cash && (
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                Maksimal {PAY_AT_WARUNG_MAX_PORTIONS} porsi per tiket bayar di warung.
              </p>
            )}
          </CheckoutCard>

          <PickupOptionsCard
            merchant={detail.data ?? null}
            userLocation={{ lat: userLat, lng: userLng }}
            user={session.user}
          />

          <PickupTimeSlotSelector
            slots={slots}
            value={slotValid ? slot : null}
            onChange={setSlot}
            deadlineLabel={deadlineLabel}
            loading={now === null}
            asapSub={cash && endIso ? `Datang sebelum ${formatClockId(endIso)}` : undefined}
          />

          <BringOwnContainerToggle
            checked={ownContainer}
            onCheckedChange={setOwnContainer}
            voucherAvailable={!cash && Boolean(vouchers.data?.vouchers.some((v) => v.code === "BAWABEKAL"))}
            onUseVoucher={() => {
              const v = vouchers.data?.vouchers.find((x) => x.code === "BAWABEKAL");
              if (!v) return;
              if (preview.subtotal_recovery_idr < v.min_subtotal_idr) {
                toast.error(`BAWABEKAL butuh minimal belanja ${formatIdr(v.min_subtotal_idr)}`);
                return;
              }
              setVoucherCode("BAWABEKAL");
              toast.success("Voucher BAWABEKAL dipakai");
            }}
          />

          {/* Phones: voucher sits between the container toggle and payment. lg+: it moves to the summary. */}
          <div className="lg:hidden">{voucherRow}</div>

          <CheckoutCard title={isPilot ? "Pembayaran" : "Metode Pembayaran"} icon={WalletIcon}>
            {isPilot ? (
              <div role="region" aria-label="Pembayaran di warung" className="text-sm leading-relaxed">
                <p>
                  <b className="font-semibold">Bayar langsung di warung</b> (tunai atau QRIS milik warung).
                </p>
                <p className="mt-1 text-muted-foreground">
                  Warung ini ikut uji coba Sisa-Saji, jadi tanpa biaya layanan dan belum menerima voucher.
                </p>
              </div>
            ) : (
              <>
                <PaymentMethodPicker value={method} onChange={changeMethod} cashDisabledReason={cashDisabledReason} />
                {cash && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Bayar tunai tanpa biaya layanan. Voucher hanya untuk bayar lewat QRIS atau dompet digital.
                  </p>
                )}
              </>
            )}
          </CheckoutCard>
        </div>

        <div className="contents lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-4">
          <div className="hidden lg:block">{voucherRow}</div>
          <PriceAndImpactBreakdown
            p={preview}
            voucherCode={voucher?.code ?? null}
            totalLabel={cash ? "Bayar di warung saat ambil" : "Total bayar"}
          >
            {/* lg+ pay action (the phone pay bar below is lg:hidden). */}
            <div className="mt-4 hidden lg:block">
              {payButton("h-12 w-full")}
              {blocked && <p className="mt-2 text-center text-xs font-semibold text-urgent">{blockedText}</p>}
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                <LockIcon className="size-3 shrink-0" aria-hidden /> {holdNote}
              </p>
            </div>
          </PriceAndImpactBreakdown>
        </div>
      </div>

      {/* ---------- Sticky pay bar ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md lg:hidden">
        <div className="safe-bottom border-t border-border/70 bg-background/95 px-4 pt-3 pb-3 shadow-float backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-muted-foreground">{cash ? "Bayar di warung" : "Total bayar"}</p>
              <p className="text-lg leading-tight font-bold">
                <Money value={preview.total_idr} />
              </p>
              <p className="truncate text-[11px] font-semibold text-primary">Hemat {formatIdr(preview.money_saved_idr)}</p>
            </div>
            {/* Smaller label on phones so the total keeps room at 360 px. */}
            {payButton("h-12 shrink-0 px-4 text-sm")}
          </div>
          {blocked ? (
            <p className="mt-2 text-center text-xs font-semibold text-urgent">{blockedText}</p>
          ) : (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">{holdNote}</p>
          )}
        </div>
      </div>

      <VoucherSelectorSheet
        open={voucherOpen}
        onOpenChange={setVoucherOpen}
        vouchers={vouchers.data?.vouchers ?? []}
        loading={vouchers.isPending}
        subtotal={preview.subtotal_recovery_idr}
        selected={voucherCode}
        onSelect={setVoucherCode}
      />
    </>
  );
}
