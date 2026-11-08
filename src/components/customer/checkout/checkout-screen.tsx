"use client";

/**
 * /checkout — CheckoutScreen + PaymentScreen entry: cart lines with steppers,
 * self-pickup card, pickup slot, own container, payment method, voucher,
 * price & impact breakdown → POST /orders/checkout → /orders/[id].
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { Loader2Icon, LockIcon, ShoppingBagIcon, StoreIcon, Trash2Icon, WalletIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
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
  CheckoutResponse,
  MerchantDetail,
  PaymentMethod,
  VouchersResponse,
} from "@/lib/contracts";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { selectCartEarliestEnd, useCartStore, type CartItem } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { useLocationStore } from "@/stores/location";
import { QtyStepper } from "../bits";
import { useBatchStream } from "../hooks/use-batch-stream";
import { checkoutErrorAction, previewTotals } from "../lib/checkout-logic";
import { generatePickupSlots } from "../lib/pickup-slots";
import { cartPatchFromBatch, customerKeys } from "../lib/queries";
import {
  BringOwnContainerToggle,
  CheckoutCard,
  PaymentMethodPicker,
  PickupTimeSlotSelector,
  PriceAndImpactBreakdown,
  SelfPickupInfoCard,
  VoucherRow,
  VoucherSelectorSheet,
} from "./checkout-parts";

type LineState = "ok" | "soldout" | "gone";

export function CheckoutScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const hydrated = useStoresHydrated();
  const now = useNow(30_000);
  const { merchant, items } = useCartStore(useShallow((s) => ({ merchant: s.merchant, items: s.items })));
  const earliestEnd = useCartStore(selectCartEarliestEnd);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateItem = useCartStore((s) => s.updateItem);
  const clearCart = useCartStore((s) => s.clear);
  const userLat = useLocationStore((s) => s.lat);
  const userLng = useLocationStore((s) => s.lng);

  const [slot, setSlot] = useState<string | null>(null);
  const [ownContainer, setOwnContainer] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("QRIS");
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

  // ---- live merchant data (fresh prices / stock for the cart lines) ----
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

  // Sync cart prices / stock caps with the latest batch data.
  useEffect(() => {
    if (!detail.data) return;
    const byId = new Map(detail.data.batches.map((b) => [b.batch_id, b]));
    for (const it of useCartStore.getState().items) {
      const b = byId.get(it.batch_id);
      if (!b || b.available_stock <= 0) continue;
      if (b.selling_price_idr !== it.unit_price_idr || Math.min(b.available_stock, 10) !== it.max_quantity) {
        updateItem(it.batch_id, cartPatchFromBatch(b));
      }
    }
  }, [detail.data, updateItem]);

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
  const blocked = items.some((i) => (lineState.get(i.batch_id) ?? "ok") !== "ok");

  const vouchers = useQuery({
    queryKey: customerKeys.vouchers,
    queryFn: () => api.get<VouchersResponse>("/vouchers"),
    staleTime: 5 * 60_000,
  });
  const voucher = vouchers.data?.vouchers.find((v) => v.code === voucherCode) ?? null;
  const preview = previewTotals({ items, voucher });

  const slots = useMemo(
    () =>
      now === null
        ? []
        : generatePickupSlots({
            nowMs: now,
            endIso: earliestEnd,
            startIso: detail.data?.batches
              .filter((b) => items.some((i) => i.batch_id === b.batch_id))
              .map((b) => b.pickup_start_time)
              .sort()
              .at(-1),
          }),
    [now, earliestEnd, detail.data, items],
  );
  // Drop a chosen slot that is no longer offered.
  const slotValid = slot === null || slots.some((s) => s.iso === slot);

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
      toast.success("Stok dikunci 10 menit. Selesaikan pembayaran QRIS.", { id: "checkout-ok" });
    },
    onError: (err) => {
      if (!(err instanceof ApiClientError)) {
        toast.error("Gagal membuat pesanan. Coba lagi.");
        return;
      }
      const action = checkoutErrorAction(err.code, err.details);
      switch (action.kind) {
        case "stock": {
          if (action.batch_id && action.available !== null) {
            const line = items.find((i) => i.batch_id === action.batch_id);
            if (action.available <= 0) removeItem(action.batch_id);
            else updateItem(action.batch_id, { max_quantity: action.available, quantity: action.available });
            toast.error(
              action.available <= 0
                ? `${line?.menu_name ?? "Menu"} sudah habis dan dihapus dari keranjang.`
                : `Stok ${line?.menu_name ?? "menu"} tinggal ${action.available} porsi — jumlah sudah disesuaikan.`,
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
          toast.error(err.message, { description: "Voucher dilepas. Kamu tetap bisa lanjut bayar." });
          break;
        case "login":
          router.replace("/auth/login?next=%2Fcheckout");
          break;
        default:
          toast.error(err.message);
      }
    },
  });

  const submit = () => {
    if (!merchant || items.length === 0 || checkout.isPending) return;
    checkout.mutate({
      merchant_id: merchant.id,
      items: items.map((i) => ({ batch_id: i.batch_id, quantity: i.quantity })),
      scheduled_pickup_time: slot && slotValid ? slot : undefined,
      uses_own_lunchbox: ownContainer,
      payment_method: method,
      voucher_code: voucher ? voucher.code : undefined,
    });
  };

  const changeQty = (item: CartItem, v: number) => {
    if (v <= 0) {
      removeItem(item.batch_id);
      toast(`${item.menu_name} dihapus`, {
        id: `rm-${item.batch_id}`,
        action: {
          label: "Urungkan",
          onClick: () => {
            const m = useCartStore.getState().merchant ?? merchant;
            if (m) useCartStore.getState().addItem(m, { ...item, quantity: 1 });
          },
        },
      });
    } else setQuantity(item.batch_id, v);
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
    if (checkout.isSuccess) return <AppSplash label="Membuka pembayaran…" />;
    return (
      <>
        <PageHeader title="Checkout" backHref="/discover" />
        <EmptyState
          icon={ShoppingBagIcon}
          title="Keranjang masih kosong"
          description="Pilih porsi surplus dari warung terdekat — hemat sampai 70% dan bantu kurangi makanan terbuang."
          action={
            <Button asChild className="h-11 rounded-full px-6 font-bold">
              <Link href="/discover">Cari makanan</Link>
            </Button>
          }
        />
      </>
    );
  }

  const deadlineLabel = earliestEnd ? formatClockId(earliestEnd) : null;

  return (
    <>
      <PageHeader title="Checkout" subtitle={`Ambil di ${merchant.name}`} backHref={`/warung/${merchant.slug}`} />

      <div className="flex flex-col gap-3 px-4 pt-4 pb-40">
        {/* ---------- Cart ---------- */}
        <CheckoutCard
          title="Pesananmu"
          icon={StoreIcon}
          action={
            <Link href={`/warung/${merchant.slug}`} className="text-xs font-bold text-primary hover:underline">
              + Tambah menu
            </Link>
          }
        >
          <p className="-mt-1 mb-3 truncate text-xs text-muted-foreground">{merchant.name}</p>
          <ul className="divide-y divide-border">
            {items.map((it) => {
              const state = lineState.get(it.batch_id) ?? "ok";
              return (
                <li key={it.batch_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className={cn("line-clamp-2 text-sm font-bold", state !== "ok" && "text-muted-foreground line-through")}>
                      {it.menu_name}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
                      <span className="font-extrabold tabular-nums">{formatIdr(it.unit_price_idr)}</span>
                      <span className="text-muted-foreground line-through tabular-nums">{formatIdr(it.original_price_idr)}</span>
                      <span className="font-bold text-deal">-{it.discount_pct}%</span>
                    </p>
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
                      max={it.max_quantity}
                      size="sm"
                      label={it.menu_name}
                      onChange={(v) => changeQty(it, v)}
                    />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-full text-xs font-bold text-urgent"
                      onClick={() => removeItem(it.batch_id)}
                    >
                      <Trash2Icon className="size-3.5" /> Hapus
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </CheckoutCard>

        <SelfPickupInfoCard
          merchant={detail.data ?? null}
          userLocation={{ lat: userLat, lng: userLng }}
        />

        <PickupTimeSlotSelector
          slots={slots}
          value={slotValid ? slot : null}
          onChange={setSlot}
          deadlineLabel={deadlineLabel}
          loading={now === null}
        />

        <BringOwnContainerToggle
          checked={ownContainer}
          onCheckedChange={setOwnContainer}
          voucherAvailable={Boolean(vouchers.data?.vouchers.some((v) => v.code === "BAWABEKAL"))}
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

        <VoucherRow
          voucher={voucher}
          subtotal={preview.subtotal_recovery_idr}
          onOpen={() => setVoucherOpen(true)}
          onClear={() => setVoucherCode(null)}
        />

        <CheckoutCard title="Metode Pembayaran" icon={WalletIcon}>
          <PaymentMethodPicker value={method} onChange={setMethod} />
          <p className="mt-2 text-xs text-muted-foreground">
            Bayar lewat QRIS dinamis — bisa dipindai dari GoPay, OVO, DANA, ShopeePay, atau m-banking.
          </p>
        </CheckoutCard>

        <PriceAndImpactBreakdown p={preview} voucherCode={voucher?.code ?? null} />
      </div>

      {/* ---------- Sticky pay bar ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md">
        <div className="safe-bottom border-t border-border/70 bg-background/95 px-4 pt-3 pb-3 shadow-float backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-muted-foreground">Total bayar</p>
              <p className="text-lg leading-tight font-extrabold">
                <Money value={preview.total_idr} />
              </p>
              <p className="truncate text-[11px] font-semibold text-primary">Hemat {formatIdr(preview.money_saved_idr)}</p>
            </div>
            <Button
              className="h-12 shrink-0 rounded-full px-6 text-base font-extrabold shadow-card"
              onClick={submit}
              disabled={checkout.isPending || blocked || !detail.data}
            >
              {checkout.isPending ? <Loader2Icon className="size-5 animate-spin" /> : <LockIcon className="size-4" />}
              Lanjut Bayar
            </Button>
          </div>
          {blocked && (
            <p className="mt-2 text-center text-xs font-semibold text-urgent">Hapus menu yang tidak tersedia untuk lanjut.</p>
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
