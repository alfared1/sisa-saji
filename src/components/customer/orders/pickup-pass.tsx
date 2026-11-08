"use client";

/**
 * Active ticket (PAID / READY_FOR_PICKUP): PickupDeadlineBanner, DigitalPickupPass
 * (big QR + SJ-XXXX + live "anti-screenshot" band), merchant card with
 * directions / WhatsApp, items, offline-saved chip.
 */
import { useState } from "react";
import {
  AlarmClockIcon,
  CalendarClockIcon,
  CloudOffIcon,
  MapPinIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  StoreIcon,
} from "lucide-react";
import { QrCodeView } from "@/components/common/qr-code-view";
import { useCountdown } from "@/hooks/use-countdown";
import { useNow } from "@/hooks/use-now";
import type { OrderDetail } from "@/lib/contracts";
import { formatClockId, wibTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DirectionsAndWhatsAppButtons, OrderItemsCard, pickupCodeLabel } from "./order-bits";

export function PickupDeadlineBanner({ deadlineIso }: { deadlineIso: string }) {
  const c = useCountdown(deadlineIso);
  const over = c.ready && c.isOver;
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl p-4 text-white shadow-card",
        over ? "bg-muted-foreground" : c.isUrgent ? "bg-gradient-to-br from-urgent to-deal" : "bg-gradient-to-br from-deal to-urgent",
      )}
      role="status"
    >
      <span className="absolute -top-8 -right-6 size-28 rounded-full bg-white/12" aria-hidden />
      <div className="relative flex items-center gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/20">
          <AlarmClockIcon className={cn("size-5", c.isUrgent && "animate-soft-pulse")} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-extrabold">
            {over
              ? "Batas pengambilan sudah lewat"
              : `Segera ambil pesanan kamu sebelum jam ${formatClockId(deadlineIso)}`}
          </p>
          <p className="text-xs text-white/85">{over ? "Hubungi warung bila masih dalam perjalanan." : "Waktu tersisa"}</p>
        </div>
        {!over && (
          <span className="shrink-0 rounded-2xl bg-white/20 px-2.5 py-1.5 text-lg font-extrabold tabular-nums" role="timer">
            {c.ready ? (c.hours > 0 ? `${c.hours}:${String(c.minutes).padStart(2, "0")}:${String(c.seconds).padStart(2, "0")}` : `${String(c.minutes).padStart(2, "0")}:${String(c.seconds).padStart(2, "0")}`) : "--:--"}
          </span>
        )}
      </div>
    </section>
  );
}

/** Live clock + moving holographic band so a screenshot is easy to tell apart from the real pass. */
function LiveBand() {
  const now = useNow(1000);
  return (
    <div className="relative mt-4 h-9 overflow-hidden rounded-xl bg-gradient-to-r from-primary via-emerald-400 to-primary">
      <div className="ss-pass-shine absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/60 to-transparent" aria-hidden />
      <div className="relative flex h-full items-center justify-center gap-2 text-xs font-extrabold text-white">
        <ShieldCheckIcon className="size-4" />
        Tiket asli · {now !== null ? `${wibTime(new Date(now))}:${String(new Date(now).getSeconds()).padStart(2, "0")}` : "--:--:--"} WIB
      </div>
      <style>{`
        @keyframes ss-pass-shine { from { left: -40%; } to { left: 110%; } }
        .ss-pass-shine { animation: ss-pass-shine 2.4s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .ss-pass-shine { animation: none; } }
      `}</style>
    </div>
  );
}

export function DigitalPickupPass({ order, savedOffline }: { order: OrderDetail; savedOffline: boolean }) {
  const [big, setBig] = useState(false);
  return (
    <article className="overflow-hidden rounded-[1.75rem] bg-card shadow-float ring-1 ring-border">
      <div className="flex items-center gap-2.5 bg-brand-soft px-4 py-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-soft">
          <StoreIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold">{order.merchant.name}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">{order.order_number}</p>
        </div>
        {savedOffline && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-card px-2 py-1 text-[11px] font-bold text-primary ring-1 ring-primary/20"
            title="Tiket ini tetap bisa dibuka tanpa internet"
          >
            <CloudOffIcon className="size-3.5" /> Tersimpan offline
          </span>
        )}
      </div>

      <div className="relative px-5 pt-5 pb-5 text-center">
        <p className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground uppercase">Kode pengambilan</p>
        <p
          className="mt-1 text-5xl font-black tracking-[0.12em] tabular-nums min-[380px]:text-[3.4rem]"
          aria-label={`Kode pengambilan ${pickupCodeLabel(order).split("").join(" ")}`}
        >
          {pickupCodeLabel(order)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Sebutkan kode ini atau tunjukkan QR ke kasir warung</p>

        {order.pickup_qr_token && (
          <button
            type="button"
            onClick={() => setBig((v) => !v)}
            className="mx-auto mt-4 block rounded-3xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={big ? "Perkecil QR" : "Perbesar QR"}
          >
            <QrCodeView
              value={order.pickup_qr_token}
              size={big ? 300 : 210}
              level="Q"
              label={`QR pengambilan ${order.order_number}`}
            />
          </button>
        )}
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <QrCodeIcon className="size-3.5" /> Ketuk QR untuk {big ? "perkecil" : "perbesar"}
        </p>
        <LiveBand />
      </div>

      {/* perforation */}
      <div className="relative border-t-2 border-dashed border-border">
        <span className="absolute -top-3 -left-3 size-6 rounded-full bg-background ring-1 ring-border" aria-hidden />
        <span className="absolute -top-3 -right-3 size-6 rounded-full bg-background ring-1 ring-border" aria-hidden />
      </div>
      <div className="space-y-1.5 px-5 py-4 text-sm">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <MapPinIcon className="mt-px size-3.5 shrink-0" /> {order.merchant.address}
        </p>
        {order.scheduled_pickup_time && (
          <p className="flex items-center gap-2 text-xs font-semibold">
            <CalendarClockIcon className="size-3.5 text-primary" /> Rencana ambil {formatClockId(order.scheduled_pickup_time)} WIB
          </p>
        )}
        <DirectionsAndWhatsAppButtons order={order} />
      </div>
    </article>
  );
}

export function PickupTicketView({ order, savedOffline }: { order: OrderDetail; savedOffline: boolean }) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-10">
      <PickupDeadlineBanner deadlineIso={order.pickup_deadline_at} />
      <DigitalPickupPass order={order} savedOffline={savedOffline} />
      <section className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
        <h2 className="text-sm font-extrabold">Cara ambil pesanan</h2>
        <ol className="mt-3 space-y-3">
          {[
            "Datang ke warung sebelum batas waktu.",
            `Tunjukkan QR atau sebutkan kode ${pickupCodeLabel(order)} ke kasir.`,
            "Warung memverifikasi dan menyerahkan pesananmu. Selesai!",
          ].map((s, i) => (
            <li key={s} className="flex items-start gap-3 text-sm">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-primary-foreground">
                {i + 1}
              </span>
              <span className="pt-0.5 leading-snug">{s}</span>
            </li>
          ))}
        </ol>
      </section>
      <OrderItemsCard order={order} />
    </div>
  );
}
