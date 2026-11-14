"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronDownIcon, MapPinIcon, RotateCwIcon, WifiIcon, WifiOffIcon } from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { Logo } from "@/components/common/logo";
import { orderLineText } from "@/components/customer/lib/order-status";
import { QrCodeView } from "@/components/common/qr-code-view";
import { Button } from "@/components/ui/button";
import { PICKUP_CODE_PREFIX } from "@/lib/constants";
import { formatClockId } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useStoresHydrated } from "@/stores/hydration";
import { useTicketOwnerSync } from "@/hooks/use-ticket-owner-sync";
import { selectTicketList, useTicketsStore, type SavedTicket } from "@/stores/tickets";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => false);
}

function TicketPass({ ticket }: { ticket: SavedTicket }) {
  const [showQr, setShowQr] = useState(false);
  const { order } = ticket;
  // Tickets saved before lauk existed have no `lauk` field; orderLineText skips it then.
  const items = order.items.map(orderLineText).join("; ");

  return (
    <article className="overflow-hidden rounded-3xl bg-card shadow-card ring-1 ring-border">
      <div className="flex items-start justify-between gap-3 bg-brand-soft/70 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{order.merchant.name}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPinIcon className="size-3 shrink-0" /> {order.merchant.address}
          </p>
        </div>
        <CountdownBadge endIso={order.pickup_deadline_at} prefix="Ambil dalam" overLabel="Lewat batas" />
      </div>
      <div className="relative border-t border-dashed border-border px-4 py-4">
        <span className="absolute -top-2.5 -left-2.5 size-5 rounded-full bg-background ring-1 ring-border" aria-hidden />
        <span className="absolute -top-2.5 -right-2.5 size-5 rounded-full bg-background ring-1 ring-border" aria-hidden />
        <p className="text-xs font-semibold text-muted-foreground">Kode pengambilan</p>
        <p className="mt-1 text-4xl font-extrabold tracking-[0.12em] tabular-nums">
          {order.pickup_code ? `${PICKUP_CODE_PREFIX}${order.pickup_code}` : "-"}
        </p>
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{items}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {order.order_number} · ambil sebelum {formatClockId(order.pickup_deadline_at)} WIB
        </p>

        {order.pickup_qr_token && (
          <>
            <button
              type="button"
              onClick={() => setShowQr((v) => !v)}
              aria-expanded={showQr}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {showQr ? "Sembunyikan QR" : "Tampilkan QR"}
              <ChevronDownIcon className={cn("size-4 transition-transform", showQr && "rotate-180")} />
            </button>
            {showQr && (
              <QrCodeView
                value={order.pickup_qr_token}
                size={220}
                label={`QR pengambilan ${order.order_number}`}
                caption="Tunjukkan ke warung untuk dipindai"
                className="mt-4"
              />
            )}
          </>
        )}
      </div>
      <div className="border-t border-border px-4 py-2.5">
        <Link href={`/orders/${order.id}`} className="text-xs font-semibold text-primary hover:underline">
          Buka detail tiket
        </Link>
      </div>
    </article>
  );
}

export function OfflineView() {
  // Online: drop tickets that are not the current session's (shared phone).
  useTicketOwnerSync();
  const online = useOnline();
  const hydrated = useStoresHydrated();
  const tickets = useTicketsStore((s) => s.tickets);
  const list = selectTicketList({ tickets });

  return (
    <div className="app-backdrop min-h-dvh">
      {/* lg+: status card on the left, saved tickets on the right (max 1024px). */}
      <div className="safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10 lg:grid lg:max-w-5xl lg:grid-cols-2 lg:content-start lg:items-start lg:gap-x-10 lg:px-8">
        <header className="flex h-16 items-center lg:col-span-2 lg:h-20">
          <Logo />
        </header>

        <section className="flex flex-col items-center pt-6 text-center lg:sticky lg:top-8 lg:mt-6 lg:rounded-3xl lg:bg-card lg:p-10 lg:shadow-card lg:ring-1 lg:ring-border">
          <div className="relative">
            <span
              className={cn(
                "relative inline-flex size-20 items-center justify-center rounded-3xl shadow-card ring-1 ring-border",
                online ? "bg-brand-soft text-primary" : "bg-card text-deal",
              )}
            >
              {online ? <WifiIcon className="size-9" /> : <WifiOffIcon className="size-9" />}
            </span>
          </div>
          <h1 className="mt-6 text-2xl font-bold">{online ? "Kamu kembali online" : "Kamu sedang offline"}</h1>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {online
              ? "Internet sudah tersambung lagi. Muat ulang untuk melanjutkan."
              : "Sambungan internet terputus. Tiket pengambilan yang sudah tersimpan tetap bisa kamu tunjukkan ke warung."}
          </p>
          <Button className="mt-5 h-11 rounded-xl px-6 font-semibold" onClick={() => window.location.reload()}>
            <RotateCwIcon /> Coba lagi
          </Button>
        </section>

        <section aria-labelledby="tiket-offline" className="mt-10 lg:mt-6">
          <h2 id="tiket-offline" className="flex items-center gap-2 text-base font-semibold">
            Tiket tersimpan
          </h2>
          {!hydrated ? null : list.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-card p-4 text-sm leading-relaxed text-muted-foreground ring-1 ring-border">
              Belum ada tiket aktif di perangkat ini. Tiket yang siap diambil otomatis tersimpan saat kamu membukanya
              dalam keadaan online.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {list.map((t) => (
                <TicketPass key={t.order.id} ticket={t} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
