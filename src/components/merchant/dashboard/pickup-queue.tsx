"use client";

import Link from "next/link";
import { ChevronRightIcon, InboxIcon, ScanLineIcon } from "lucide-react";
import type { OrderDetail } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { MerchantOrderCard, portionsOf } from "../orders/order-card";

/** Blueprint IncomingPickupQueue — paid orders waiting to be collected, soonest deadline first. */
export function IncomingPickupQueue({ orders, className }: { orders: OrderDetail[]; className?: string }) {
  const sorted = [...orders].sort((a, b) => Date.parse(a.pickup_deadline_at) - Date.parse(b.pickup_deadline_at));
  const portions = sorted.reduce((s, o) => s + portionsOf(o), 0);

  return (
    <section aria-labelledby="queue-heading" className={cn("rounded-3xl bg-card shadow-soft ring-1 ring-border", className)}>
      <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div>
          <h2 id="queue-heading" className="text-lg leading-tight font-extrabold tracking-tight">
            Antrean ambil
          </h2>
          <p className="text-xs text-muted-foreground">
            {sorted.length > 0 ? `${sorted.length} pesanan · ${portions} porsi menunggu diambil` : "Pesanan dibayar muncul di sini secara live"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex min-w-9 items-center justify-center rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums",
            sorted.length ? "bg-deal text-deal-foreground" : "bg-muted text-muted-foreground",
          )}
          aria-label={`${sorted.length} pesanan menunggu`}
        >
          {sorted.length}
        </span>
      </header>

      <div className="p-4 sm:p-5">
        <Link
          href="/merchant/orders/scan"
          className="mb-3 flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-base font-extrabold text-primary-foreground shadow-card outline-none transition-transform active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ScanLineIcon className="size-5" /> Scan / Verifikasi
        </Link>

        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center">
            <InboxIcon className="size-7 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold">Belum ada yang antre</p>
            <p className="max-w-60 text-xs text-muted-foreground">Kami kirim notifikasi begitu ada pembeli yang membayar.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {sorted.slice(0, 6).map((o) => (
              <li key={o.id}>
                <MerchantOrderCard order={o} compact />
              </li>
            ))}
          </ul>
        )}

        {sorted.length > 0 && (
          <Link
            href="/merchant/orders"
            className="mt-3 flex h-11 items-center justify-center gap-1 rounded-2xl text-sm font-semibold text-primary outline-none hover:bg-brand-soft focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Semua pesanan <ChevronRightIcon className="size-4" />
          </Link>
        )}
      </div>
    </section>
  );
}
