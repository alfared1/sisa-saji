"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarIcon, ClipboardCheckIcon, HistoryIcon, InboxIcon, ScanLineIcon, XIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNow } from "@/hooks/use-now";
import { api } from "@/lib/api/client";
import type { OrderDetail, OrdersResponse } from "@/lib/contracts";
import { DAY_NAMES_ID, formatIdr, wibDate, wibDayOfWeek } from "@/lib/time";
import { merchantKeys, useMerchantReady } from "../lib/queries";
import { useMerchantLive } from "../lib/use-merchant-live";
import { LiveDot } from "../dashboard/store-status-header";
import { MerchantPage, MerchantPageHeader } from "../ui";
import { PAY_AT_WARUNG_HOLD_MINUTES } from "@/lib/constants";
import { isCancellableTicket } from "./cancel-ticket";
import { MerchantOrderCard, portionsOf } from "./order-card";

type Tab = "active" | "today" | "history";

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function formatDateLabel(date: string, today: string): string {
  if (date === today) return "Hari ini";
  const [y, m, d] = date.split("-").map(Number);
  return `${DAY_NAMES_ID[wibDayOfWeek(date)]}, ${d} ${MONTHS_ID[m - 1]} ${y}`;
}

function groupByDate(orders: OrderDetail[]): [string, OrderDetail[]][] {
  const map = new Map<string, OrderDetail[]>();
  for (const o of orders) {
    const d = wibDate(new Date(o.created_at));
    const arr = map.get(d) ?? [];
    arr.push(o);
    map.set(d, arr);
  }
  // Within a day, newest first by the time the card shows (pickup time, else order time).
  const shownAt = (o: OrderDetail) => Date.parse(o.picked_up_at ?? o.created_at);
  return [...map.entries()].map(([d, list]) => [d, list.sort((a, b) => shownAt(b) - shownAt(a))]);
}

function OrderList({ orders, actions = false }: { orders: OrderDetail[]; actions?: boolean }) {
  return (
    <ul className="grid gap-2.5 lg:grid-cols-2">
      {orders.map((o) => (
        <li key={o.id}>
          <MerchantOrderCard order={o} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

/** /merchant/orders — Aktif / Selesai Hari Ini / Riwayat. */
export function MerchantOrdersView() {
  const [tab, setTab] = useState<Tab>("active");
  const [historyDate, setHistoryDate] = useState("");
  const now = useNow(60_000);
  const today = now !== null ? wibDate(new Date(now)) : "";
  const live = useMerchantLive();
  const ready = useMerchantReady();

  const query = useQuery({
    queryKey: merchantKeys.orders(tab, tab === "today" ? today : tab === "history" ? historyDate : undefined),
    enabled: ready && (tab !== "today" || today !== ""),
    queryFn: () =>
      api.get<OrdersResponse>(
        "/merchant/orders",
        tab === "active"
          ? { status: "ACTIVE", limit: 100 }
          : tab === "today"
            ? { status: "COMPLETED", date: today, limit: 200 }
            : { date: historyDate || undefined, limit: 100 },
      ),
    staleTime: 10_000,
  });

  const orders = query.data?.orders ?? [];
  const waiting = orders.filter((o) => o.status === "PAID" || o.status === "READY_FOR_PICKUP");
  const unpaid = orders.filter((o) => o.status === "PENDING_PAYMENT");
  const payout = orders.filter((o) => o.status === "COMPLETED").reduce((s, o) => s + o.net_merchant_payout_idr, 0);
  const portions = orders.reduce((s, o) => s + portionsOf(o), 0);

  return (
    <MerchantPage>
      <MerchantPageHeader
        title="Pesanan"
        subtitle={
          <span className="inline-flex items-center gap-2">
            Kode pengambilan hanya ada di HP pembeli. <LiveDot status={live.status} />
          </span>
        }
        actions={
          <Link
            href="/merchant/orders/scan"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft"
          >
            <ScanLineIcon className="size-4" /> Scan tiket
          </Link>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="grid h-12! w-full grid-cols-3 rounded-2xl bg-muted p-1 sm:w-auto sm:min-w-[30rem]">
          <TabsTrigger value="active" className="h-full rounded-xl px-1 text-xs font-semibold data-active:shadow-soft max-sm:[&_svg]:hidden sm:text-sm">
            Aktif
          </TabsTrigger>
          <TabsTrigger value="today" className="h-full rounded-xl px-1 text-xs font-semibold data-active:shadow-soft max-sm:[&_svg]:hidden sm:text-sm">
            Selesai Hari Ini
          </TabsTrigger>
          <TabsTrigger value="history" className="h-full rounded-xl px-1 text-xs font-semibold data-active:shadow-soft max-sm:[&_svg]:hidden sm:text-sm">
            Riwayat
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "history" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="relative inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-card px-4 text-sm font-semibold ring-1 ring-border">
            <CalendarIcon className="size-4 text-primary" aria-hidden />
            <span className="sr-only">Filter tanggal</span>
            <input
              type="date"
              value={historyDate}
              max={today || undefined}
              onChange={(e) => setHistoryDate(e.target.value)}
              className="h-full bg-transparent tabular-nums outline-none"
            />
          </label>
          {historyDate && (
            <button
              type="button"
              onClick={() => setHistoryDate("")}
              className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
            >
              <XIcon className="size-4" /> Semua tanggal
            </button>
          )}
        </div>
      )}

      <div className="mt-4" aria-live="polite">
        {query.isPending ? (
          <ListSkeleton variant="row" count={5} className="rounded-3xl bg-card px-4 ring-1 ring-border" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : orders.length === 0 ? (
          <div className="rounded-3xl bg-card ring-1 ring-border">
            {tab === "active" ? (
              <EmptyState icon={InboxIcon} title="Tidak ada pesanan aktif" description="Pesanan yang sudah dibayar dan menunggu diambil akan muncul di sini secara live." />
            ) : tab === "today" ? (
              <EmptyState icon={ClipboardCheckIcon} title="Belum ada yang selesai hari ini" description="Setelah kamu memverifikasi kode pembeli, pesanannya tercatat di sini." />
            ) : (
              <EmptyState icon={HistoryIcon} title="Riwayat kosong" description={historyDate ? "Tidak ada pesanan pada tanggal ini." : "Belum ada pesanan."} />
            )}
          </div>
        ) : tab === "active" ? (
          <div className="space-y-6">
            {waiting.length > 0 && (
              <section aria-labelledby="waiting-h">
                <h2 id="waiting-h" className="mb-2 text-sm font-semibold">
                  Menunggu diambil <span className="text-muted-foreground tabular-nums">({waiting.length})</span>
                </h2>
                {waiting.some(isCancellableTicket) && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Tiket bayar di warung menahan porsi paling lama {PAY_AT_WARUNG_HOLD_MINUTES} menit, lalu batal otomatis bila
                    tidak diambil. Bila pembeli belum datang mendekati batas waktu, kamu bisa membatalkan tiketnya.
                  </p>
                )}
                <OrderList
                  actions
                  orders={[...waiting].sort((a, b) => Date.parse(a.pickup_deadline_at) - Date.parse(b.pickup_deadline_at))}
                />
              </section>
            )}
            {unpaid.length > 0 && (
              <section aria-labelledby="unpaid-h">
                <h2 id="unpaid-h" className="mb-2 text-sm font-semibold">
                  Menunggu pembayaran <span className="text-muted-foreground tabular-nums">({unpaid.length})</span>
                </h2>
                <p className="mb-2 text-xs text-muted-foreground">Stok dikunci 10 menit selama pembeli membayar QRIS.</p>
                <OrderList orders={unpaid} />
              </section>
            )}
          </div>
        ) : tab === "today" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-brand-soft px-3 py-1.5 font-semibold text-primary tabular-nums">{orders.length} pesanan</span>
              <span className="rounded-full bg-card px-3 py-1.5 font-semibold ring-1 ring-border tabular-nums">{portions} porsi</span>
              <span className="rounded-full bg-card px-3 py-1.5 font-semibold ring-1 ring-border tabular-nums">+{formatIdr(payout)}</span>
            </div>
            <OrderList orders={orders} />
          </div>
        ) : (
          <div className="space-y-6">
            {groupByDate(orders).map(([date, list]) => (
              <section key={date} aria-label={formatDateLabel(date, today)}>
                <h2 className="mb-2 text-sm font-semibold">
                  {formatDateLabel(date, today)} <span className="font-medium text-muted-foreground tabular-nums">· {list.length} pesanan</span>
                </h2>
                <OrderList orders={list} />
              </section>
            ))}
            {orders.length >= 100 && <p className="text-center text-xs text-muted-foreground">Menampilkan 100 pesanan terbaru. Pilih tanggal untuk melihat lebih lama.</p>}
          </div>
        )}
      </div>
    </MerchantPage>
  );
}
