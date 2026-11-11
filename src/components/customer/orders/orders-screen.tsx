"use client";

/**
 * /orders — order history with tabs Belum Dibayar / Siap Diambil / Selesai /
 * Dibatalkan (tab kept in ?tab=), live countdowns and offline fallback.
 */
import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BanIcon, ChevronRightIcon, CircleCheckBigIcon, QrCodeIcon, ReceiptTextIcon, RotateCwIcon, WalletIcon } from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState, isNetworkError } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { Money } from "@/components/common/money";
import { ShellHeader } from "@/components/shell/customer-shell";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api/client";
import type { OrderDetail, OrdersResponse } from "@/lib/contracts";
import { formatKg } from "@/lib/impact";
import { cn } from "@/lib/utils";
import { useStoresHydrated } from "@/stores/hydration";
import { selectTicketList, useTicketsStore } from "@/stores/tickets";
import { LoginCta, OrderStatusChip, TabTitle } from "../bits";
import { formatDateTimeId } from "../lib/format";
import { ORDER_TABS, defaultOrderTab, groupOrdersByTab, parseOrderTab, type OrderTabKey } from "../lib/order-status";
import { customerKeys } from "../lib/queries";
import { pickupCodeLabel } from "./order-bits";

function OrderCard({ order }: { order: OrderDetail }) {
  const items = order.items.map((i) => `${i.quantity}× ${i.menu_name}`).join(", ");
  const ready = order.status === "READY_FOR_PICKUP" || order.status === "PAID";
  const pending = order.status === "PENDING_PAYMENT";
  return (
    <Link
      href={`/orders/${order.id}`}
      className={cn(
        "block overflow-hidden rounded-3xl bg-card shadow-soft ring-1 ring-border transition-all outline-none hover:shadow-card focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]",
        ready && "ring-primary/30",
      )}
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold">{order.merchant.name}</p>
          {/* Same clipped-separator trick as ImpactLine: when the date wraps, its "·" lands in the clipped margin. */}
          <p className="overflow-hidden text-[11px] text-muted-foreground tabular-nums">
            <span className="-ml-2 flex flex-wrap">
              <span className="pl-2 whitespace-nowrap">{order.order_number}</span>
              <span className="relative pl-2 whitespace-nowrap">
                <span className="absolute inset-y-0 left-0 w-2 text-center" aria-hidden>
                  ·
                </span>
                {formatDateTimeId(order.created_at)}
              </span>
            </span>
          </p>
        </div>
        <OrderStatusChip status={order.status} />
      </div>
      <p className="line-clamp-2 px-4 text-sm text-foreground/80">{items}</p>

      {ready && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl bg-brand-soft p-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-soft">
            <QrCodeIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-secondary-foreground">Kode pengambilan</p>
            <p className="text-xl leading-tight font-black tracking-[0.1em] tabular-nums">{pickupCodeLabel(order)}</p>
          </div>
          <CountdownBadge endIso={order.pickup_deadline_at} prefix="Ambil" overLabel="Lewat batas" variant="solid" />
        </div>
      )}
      {pending && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl bg-deal-soft p-3">
          <WalletIcon className="size-5 shrink-0 text-deal" />
          <p className="min-w-0 flex-1 text-xs font-semibold text-balance">Bayar sebelum stok dilepas</p>
          <CountdownBadge endIso={order.payment_expires_at} prefix="Bayar" overLabel="Habis" variant="solid" />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <div className="min-w-0 text-xs text-muted-foreground">
          {order.status === "COMPLETED" ? (
            <span className="font-semibold text-primary">
              +{formatKg(order.food_saved_grams)} pangan · hemat <Money value={order.money_saved_idr} />
            </span>
          ) : (
            <>
              Total <Money value={order.total_customer_paid_idr} className="font-extrabold text-foreground" />
            </>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-primary">
          {ready ? "Buka tiket" : pending ? "Bayar sekarang" : order.status === "COMPLETED" && !order.review ? "Beri ulasan" : "Detail"}
          <ChevronRightIcon className="size-4" />
        </span>
      </div>
    </Link>
  );
}

const EMPTY_COPY: Record<OrderTabKey, { title: string; description: string; icon: typeof ReceiptTextIcon }> = {
  unpaid: { title: "Tidak ada tagihan", description: "Semua pesananmu sudah dibayar.", icon: WalletIcon },
  ready: {
    title: "Belum ada tiket aktif",
    description: "Pesan porsi surplus malam ini, nanti tiket pengambilanmu akan muncul di sini.",
    icon: QrCodeIcon,
  },
  done: {
    title: "Belum ada pesanan selesai",
    description: "Setiap porsi yang kamu selamatkan tercatat sebagai dampak di sini.",
    icon: CircleCheckBigIcon,
  },
  cancelled: { title: "Tidak ada pesanan dibatalkan", description: "Riwayat pembatalan akan muncul di sini.", icon: BanIcon },
};

export function OrdersScreen() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const hydrated = useStoresHydrated();
  const tickets = useTicketsStore((s) => s.tickets);
  const loggedIn = Boolean(session.user);

  const q = useQuery({
    queryKey: customerKeys.orders("all"),
    queryFn: () => api.get<OrdersResponse>("/orders", { limit: 100 }),
    enabled: loggedIn,
    refetchInterval: 20_000,
  });

  const offline = q.isError && isNetworkError(q.error);
  const orders = useMemo(() => {
    if (q.data) return q.data.orders;
    if (offline && hydrated) return selectTicketList({ tickets }).map((t) => t.order);
    return [];
  }, [q.data, offline, hydrated, tickets]);
  const groups = useMemo(() => groupOrdersByTab(orders), [orders]);
  const tab: OrderTabKey = parseOrderTab(params.get("tab")) ?? defaultOrderTab(groups);

  const setTab = (t: OrderTabKey) => router.replace(`${pathname}?tab=${t}`, { scroll: false });

  // Phones: the tab strip scrolls sideways, so a deep link to the last tab
  // (?tab=cancelled) would leave it off-screen. Nudge scrollLeft only when the
  // active tab is clipped (scrollIntoView could also jump the page vertically).
  const tabListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = tabListRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !el) return;
    const l = list.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < l.left + 16) list.scrollLeft -= l.left + 16 - r.left;
    else if (r.right > l.right - 16) list.scrollLeft += r.right - (l.right - 16);
    // groups: the count badges arrive with the data and widen the strip.
  }, [tab, loggedIn, groups]);

  return (
    <>
      <ShellHeader className="[&>div]:pb-0">
        <TabTitle
          title="Pesanan"
          subtitle="Tiket pengambilan & riwayat"
          action={
            loggedIn && (
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-10 rounded-full"
                onClick={() => void q.refetch()}
                aria-label="Perbarui pesanan"
                disabled={q.isFetching}
              >
                <RotateCwIcon className={cn("size-4", q.isFetching && "animate-spin")} />
              </Button>
            )
          }
        />
        {loggedIn && (
          <div ref={tabListRef} role="tablist" aria-label="Status pesanan" className="no-scrollbar -mx-4 mt-3 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:mt-5 lg:border-b lg:border-border lg:px-0">
            {ORDER_TABS.map((t) => {
              const active = tab === t.key;
              const count = groups[t.key].length;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "relative inline-flex h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-bold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  {count > 0 && (t.key === "unpaid" || t.key === "ready") && (
                    <span
                      className={cn(
                        "inline-flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-5 font-extrabold tabular-nums",
                        t.key === "ready" ? "bg-primary text-primary-foreground" : "bg-deal text-deal-foreground",
                      )}
                    >
                      {count}
                    </span>
                  )}
                  <span
                    className={cn(
                      "absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-primary transition-opacity",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })}
          </div>
        )}
      </ShellHeader>

      <div className="px-4 pt-4 pb-6 lg:pt-6" role="tabpanel">
        {session.isLoading ? (
          <ListSkeleton count={3} />
        ) : !loggedIn ? (
          <LoginCta
            title="Masuk untuk melihat pesanan"
            description="Tiket pengambilan, status pembayaran, dan riwayat penyelamatan makananmu ada di sini."
            next="/orders"
            icon={<ReceiptTextIcon className="size-9 text-primary" />}
          />
        ) : q.isPending ? (
          <ListSkeleton count={3} />
        ) : q.isError && !offline ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : (
          <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0">
            {offline && (
              <div className="lg:col-span-2">
                <ErrorState
                  compact
                  error={q.error}
                  message="Offline. Menampilkan tiket yang tersimpan di perangkat."
                  onRetry={() => void q.refetch()}
                />
              </div>
            )}
            {groups[tab].length === 0 ? (
              <EmptyState
                className="lg:col-span-2"
                icon={EMPTY_COPY[tab].icon}
                title={EMPTY_COPY[tab].title}
                description={EMPTY_COPY[tab].description}
                action={
                  (tab === "ready" || tab === "done") && (
                    <Button asChild className="h-11 rounded-full px-6 font-bold">
                      <Link href="/discover">Cari makanan surplus</Link>
                    </Button>
                  )
                }
              />
            ) : (
              groups[tab].map((o) => <OrderCard key={o.id} order={o} />)
            )}
          </div>
        )}
      </div>
    </>
  );
}
