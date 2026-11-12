"use client";

/**
 * Active ticket (PAID / READY_FOR_PICKUP): PickupDeadlineBanner, DigitalPickupPass
 * (big QR + SJ-XXXX + live "anti-screenshot" band), merchant card with
 * directions / WhatsApp, items, offline-saved chip.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClockIcon, CalendarClockIcon, CloudOffIcon, MapPinIcon, ShieldCheckIcon, StoreIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { QrCodeView } from "@/components/common/qr-code-view";
import { Button } from "@/components/ui/button";
import { ApiClientError, api } from "@/lib/api/client";
import { useCountdown } from "@/hooks/use-countdown";
import { useNow } from "@/hooks/use-now";
import type { OrderDetail, OrderResponse } from "@/lib/contracts";
import { formatClockId, formatIdr, wibTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { customerKeys } from "../lib/queries";
import { DirectionsAndWhatsAppButtons, OrderItemsCard, pickupCodeLabel } from "./order-bits";

/**
 * Pilot warung ticket: the customer pays the warung at pickup (cash or the warung's own
 * QRIS), so the amount is shown up front and the ticket stays cancellable until then.
 */
function PayAtWarungCard({ order }: { order: OrderDetail }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const cancel = useMutation({
    mutationFn: () => api.post<OrderResponse>(`/orders/${order.id}/cancel`),
    onSuccess: (res) => {
      qc.setQueryData(customerKeys.order(order.id), res);
      void qc.invalidateQueries({ queryKey: customerKeys.ordersAll });
      setConfirm(false);
      toast("Pesanan dibatalkan", { description: "Porsinya dikembalikan ke warung." });
    },
    onError: (err) => {
      setConfirm(false);
      toast.error(err instanceof ApiClientError ? err.message : "Gagal membatalkan pesanan.");
    },
  });
  return (
    <section aria-label="Pembayaran di warung" className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
      <p className="text-sm font-semibold text-muted-foreground">Bayar langsung di warung</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{formatIdr(order.total_customer_paid_idr)}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Tunai atau QRIS milik warung, saat kamu mengambil. Warung ini ikut uji coba Sisa-Saji, jadi tanpa biaya layanan.
      </p>
      <Button
        variant="ghost"
        className="mt-2 -ml-2 h-10 rounded-xl px-2 text-sm font-semibold text-urgent hover:bg-urgent-soft hover:text-urgent"
        onClick={() => setConfirm(true)}
      >
        Batalkan pesanan
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        destructive
        title="Batalkan pesanan?"
        description="Porsi yang disimpan untukmu dikembalikan ke warung dan bisa dipesan orang lain."
        confirmLabel="Ya, batalkan"
        cancelLabel="Kembali"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </section>
  );
}

export function PickupDeadlineBanner({ deadlineIso }: { deadlineIso: string }) {
  const c = useCountdown(deadlineIso);
  const over = c.ready && c.isOver;
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl p-4 text-white shadow-card",
        over
          ? "bg-muted-foreground dark:bg-stone-600"
          : c.isUrgent
            ? "bg-red-700"
            : "bg-flash",
      )}
      role="status"
    >
      <div className="relative flex items-center gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/20">
          <AlarmClockIcon className={cn("size-5", c.isUrgent && "animate-soft-pulse")} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-semibold">
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
    <div className="relative mt-4 h-9 overflow-hidden rounded-xl bg-impact">
      <div className="ss-pass-shine absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/60 to-transparent" aria-hidden />
      <div className="relative flex h-full items-center justify-center gap-2 text-xs font-semibold text-white">
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
    <article className="overflow-hidden rounded-3xl bg-card shadow-card ring-1 ring-border">
      <div className="flex items-center gap-2.5 bg-brand-soft px-4 py-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-soft">
          <StoreIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{order.merchant.name}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">{order.order_number}</p>
        </div>
        {savedOffline && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-card px-2 py-1 text-[11px] font-semibold text-primary ring-1 ring-primary/20"
            title="Tiket ini tetap bisa dibuka tanpa internet"
          >
            <CloudOffIcon className="size-3.5" /> Tersimpan offline
          </span>
        )}
      </div>

      <div className="relative px-5 pt-5 pb-5 text-center">
        <p className="text-xs font-semibold text-muted-foreground">Kode pengambilan</p>
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
          Ketuk QR untuk {big ? "perkecil" : "perbesar"}
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
  const payAtWarung = order.payment_method === "BAYAR_DI_WARUNG" && !order.paid_at;
  const steps = [
    "Datang ke warung sebelum batas waktu.",
    `Tunjukkan QR atau sebutkan kode ${pickupCodeLabel(order)} ke kasir.`,
    ...(payAtWarung ? [`Bayar ${formatIdr(order.total_customer_paid_idr)} langsung ke warung, tunai atau QRIS warung.`] : []),
    "Warung memverifikasi kode, lalu menyerahkan pesananmu.",
  ];
  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-10 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start lg:gap-6 lg:pt-6">
      {/* lg+: primary column (display:contents on phones keeps the single flex column). */}
      <div className="contents lg:flex lg:flex-col lg:gap-4">
        <PickupDeadlineBanner deadlineIso={order.pickup_deadline_at} />
        <DigitalPickupPass order={order} savedOffline={savedOffline} />
        {payAtWarung && <PayAtWarungCard order={order} />}
      </div>
      {/* lg+: sticky details column. */}
      <div className="contents lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-4">
      <section className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
        <h2 className="text-sm font-semibold">Cara ambil pesanan</h2>
        <ol className="mt-3 space-y-3">
          {steps.map((s, i) => (
            <li key={s} className="flex items-start gap-3 text-sm">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <span className="pt-0.5 leading-snug">{s}</span>
            </li>
          ))}
        </ol>
      </section>
      <OrderItemsCard order={order} />
      </div>
    </div>
  );
}
