"use client";

/**
 * PaymentScreen (PENDING_PAYMENT): dynamic QRIS, amount, 10-minute countdown,
 * method chips, "Unduh QR", demo payment simulator, cancel, TimesUpModal.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DownloadIcon, Loader2Icon, ShieldCheckIcon, TimerOffIcon, XCircleIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Money } from "@/components/common/money";
import { QrCodeView } from "@/components/common/qr-code-view";
import { TudungPlate } from "@/components/common/tudung-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useCountdown } from "@/hooks/use-countdown";
import { ApiClientError, api } from "@/lib/api/client";
import { PAYMENT_TTL_SECONDS } from "@/lib/constants";
import type { OrderDetail, OrderResponse, PaymentMethod } from "@/lib/contracts";
import { formatClockId } from "@/lib/time";
import { cn } from "@/lib/utils";
import { customerKeys } from "../lib/queries";
import { OrderItemsCard } from "./order-bits";
import { OrderSteps } from "./order-steps";

const METHOD_CHIPS: { key: PaymentMethod | "SHOPEEPAY" | "BANK"; label: string }[] = [
  { key: "QRIS", label: "QRIS" },
  { key: "GOPAY", label: "GoPay" },
  { key: "OVO", label: "OVO" },
  { key: "DANA", label: "DANA" },
  { key: "SHOPEEPAY", label: "ShopeePay" },
  { key: "BANK", label: "m-Banking" },
];

/** Wallet choices that are settled by scanning the same QRIS ("Bayar dengan GoPay lewat QRIS"). */
const WALLET_NAMES: Partial<Record<PaymentMethod, string>> = { GOPAY: "GoPay", DANA: "DANA" };

async function downloadQrPng(container: HTMLElement | null, fileName: string) {
  const svg = container?.querySelector("svg");
  if (!svg) throw new Error("QR tidak ditemukan");
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Gagal memuat QR"));
      img.src = url;
    });
    const size = 1024;
    const pad = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size + pad * 2;
    canvas.height = size + pad * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, pad, pad, size, size);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("Gagal membuat gambar");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Demo only: stands in for the buyer's payment app after scanning the QRIS. "Bayar" sends the
 * same signed webhook a real gateway would, so the order moves on exactly as in production.
 */
function SimulatedWalletDialog({
  open,
  onOpenChange,
  order,
  methodName,
  paying,
  onPay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail;
  methodName: string;
  paying: boolean;
  onPay: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-3xl p-0 sm:max-w-sm" showCloseButton={!paying}>
        <div className="rounded-t-3xl bg-warning-soft px-5 py-2 text-center text-xs font-semibold text-amber-900 dark:text-amber-100">
          Simulasi aplikasi pembayaran · tanpa uang sungguhan
        </div>
        <div className="px-6 pt-4 pb-6">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg font-bold">Bayar dengan {methodName}</DialogTitle>
            <DialogDescription className="text-sm">
              Ke Sisa-Saji · {order.merchant.name}
            </DialogDescription>
          </DialogHeader>
          <dl className="mt-4 space-y-2 rounded-2xl bg-surface p-4 text-sm ring-1 ring-border">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Pesanan</dt>
              <dd className="font-semibold tabular-nums">{order.order_number}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="text-xl font-extrabold tabular-nums">
                <Money value={order.total_customer_paid_idr} />
              </dd>
            </div>
          </dl>
          <Button className="mt-4 h-12 w-full rounded-xl text-base font-semibold" onClick={onPay} disabled={paying}>
            {paying ? (
              <>
                <Loader2Icon className="size-5 animate-spin" aria-hidden /> Memproses…
              </>
            ) : (
              <>
                <ShieldCheckIcon className="size-5" aria-hidden /> Bayar
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "2 porsi Nasi Timbel sudah dikunci untukmu" (one menu) or "3 porsi sudah dikunci untukmu" (several). */
function lockedLine(order: OrderDetail): string {
  const portions = order.items.reduce((n, it) => n + it.quantity, 0);
  const names = new Set(order.items.map((it) => it.menu_name));
  const what = names.size === 1 ? `${portions} porsi ${order.items[0].menu_name}` : `${portions} porsi`;
  return `${what} sudah dikunci untukmu`;
}

export function PaymentView({ order }: { order: OrderDetail }) {
  const qc = useQueryClient();
  // Red only in the last 2 minutes, so red keeps meaning "now".
  const c = useCountdown(order.payment_expires_at, 2);
  const qrRef = useRef<HTMLDivElement>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [timesUpDismissed, setTimesUpDismissed] = useState(false);
  const key = customerKeys.order(order.id);

  const onOrder = ({ order: o }: OrderResponse) => {
    qc.setQueryData(key, { order: o });
    void qc.invalidateQueries({ queryKey: customerKeys.ordersAll });
  };

  const pay = useMutation({
    mutationFn: () => api.post<OrderResponse>(`/orders/${order.id}/simulate-payment`),
    onSuccess: (res) => {
      onOrder(res);
      toast.success("Pembayaran berhasil", { description: "Tiket pengambilanmu sudah aktif." });
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : "Simulasi pembayaran gagal.");
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post<OrderResponse>(`/orders/${order.id}/cancel`),
    onSuccess: (res) => {
      onOrder(res);
      setConfirmCancel(false);
      toast("Pesanan dibatalkan", { description: "Stok yang dikunci sudah dikembalikan ke warung." });
    },
    onError: (err) => {
      setConfirmCancel(false);
      toast.error(err instanceof ApiClientError ? err.message : "Gagal membatalkan pesanan.");
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  const totalTtl = Math.max(
    60,
    Math.round((Date.parse(order.payment_expires_at) - Date.parse(order.created_at)) / 1000) || PAYMENT_TTL_SECONDS,
  );
  const pct = c.ready ? Math.min(100, (c.totalSeconds / totalTtl) * 100) : 100;
  const timesUp = c.ready && c.isOver;
  const mmss = `${String(Math.floor(c.totalSeconds / 60)).padStart(2, "0")}:${String(c.seconds).padStart(2, "0")}`;
  const walletName = WALLET_NAMES[order.payment_method] ?? null;

  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-10 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start lg:gap-6 lg:pt-6">
      {/* lg+: primary column (display:contents on phones keeps the single flex column). */}
      <div className="contents lg:flex lg:flex-col lg:gap-4">
      <OrderSteps at="pay" />

      {/* Portion locked: the tudung settles over the plate, then the payment countdown. */}
      <section
        aria-labelledby="judul-kunci"
        className="ss-anyaman flex flex-col items-center gap-3 rounded-3xl bg-deep px-4 pt-5 pb-4 text-center text-on-deep"
      >
        <TudungPlate cover="settle" className="h-20 w-28 text-on-deep" />
        <h2 id="judul-kunci" className="text-lg leading-snug font-bold text-balance">
          {lockedLine(order)}
        </h2>
        <p className="flex flex-wrap items-baseline justify-center gap-2 text-sm text-leaf" aria-live="polite">
          <span>{timesUp ? "Waktu bayar habis" : "Bayar dalam"}</span>
          <span
            className={cn("text-3xl font-extrabold tabular-nums", c.isUrgent || timesUp ? "text-on-deep-urgent" : "text-on-deep")}
            role="timer"
            aria-label={`Sisa waktu ${mmss}`}
          >
            {c.ready ? mmss : "10:00"}
          </span>
        </p>
        <Progress
          value={pct}
          className={cn(
            "h-1 bg-on-deep/20 *:data-[slot=progress-indicator]:bg-current",
            c.isUrgent ? "text-on-deep-urgent" : "text-leaf",
          )}
          aria-hidden
        />
        <p className="text-[13px] leading-relaxed text-balance text-leaf">
          Porsi dikunci sampai {formatClockId(order.payment_expires_at)} WIB. Lewat dari itu, porsi kembali ke stok warung.
        </p>
      </section>

      {/* QRIS */}
      <section className="rounded-3xl bg-card p-5 text-center shadow-card ring-1 ring-border">
        <div className="flex items-center justify-center gap-2">
          <span className="rounded-md bg-foreground px-2 py-1 text-xs font-black tracking-widest text-background">QRIS</span>
          <span className="text-xs font-semibold text-muted-foreground">Sisa-Saji · {order.merchant.name}</span>
        </div>
        {walletName && (
          // GoPay / DANA are paid by scanning this QRIS from the wallet app; say so instead of implying a wallet link.
          <h2 className="mt-3 text-base font-bold">Bayar dengan {walletName} lewat QRIS</h2>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Total pembayaran</p>
        <p className="text-3xl font-extrabold text-deal tabular-nums">
          <Money value={order.total_customer_paid_idr} />
        </p>
        <span aria-hidden className="mx-auto mt-1.5 block h-1 w-9 rounded-full bg-plate" />
        <div ref={qrRef} className="mt-4">
          {order.qris_string ? (
            <QrCodeView
              value={order.qris_string}
              size={240}
              label={`QRIS pembayaran ${order.order_number}`}
              className={cn(timesUp && "opacity-30 blur-[2px]")}
            />
          ) : (
            <p className="py-10 text-sm text-muted-foreground">QRIS tidak tersedia.</p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="Bisa dibayar dengan">
          {METHOD_CHIPS.map((m) => (
            <span
              key={m.key}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                m.key === order.payment_method ? "bg-brand-soft text-primary ring-primary/40" : "bg-muted text-foreground/70 ring-transparent",
              )}
            >
              {m.label}
            </span>
          ))}
        </div>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin text-primary" aria-hidden /> Menunggu pembayaran…
        </p>
        <Button
          variant="outline"
          className="mt-4 h-11 rounded-xl px-5 font-semibold"
          disabled={!order.qris_string}
          onClick={() =>
            downloadQrPng(qrRef.current, `QRIS-${order.order_number}.png`)
              .then(() => toast.success("QR disimpan ke perangkat"))
              .catch(() => toast.error("Gagal mengunduh QR"))
          }
        >
          <DownloadIcon className="size-4" /> Unduh QR
        </Button>
      </section>
      </div>

      {/* lg+: sticky details column. */}
      <div className="contents lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-4">
      {/* Demo simulator */}
      <section className="rounded-3xl border-2 border-dashed border-amber-300 bg-warning-soft p-4 dark:border-amber-800">
        <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Mode demo</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900/85 dark:text-amber-100/85">
          Tidak perlu uang sungguhan. Coba alur bayarnya di sini.
        </p>
        <Button
          className="mt-3 h-12 w-full rounded-xl bg-foreground text-base font-semibold text-background hover:bg-foreground/90"
          onClick={() => setSimOpen(true)}
          disabled={pay.isPending || timesUp}
        >
          Simulasi Bayar
        </Button>
      </section>
      <SimulatedWalletDialog
        open={simOpen && !timesUp}
        onOpenChange={(o) => !pay.isPending && setSimOpen(o)}
        order={order}
        methodName={walletName ?? "QRIS"}
        paying={pay.isPending}
        onPay={() => pay.mutate()}
      />

      <OrderItemsCard order={order} />

      <Button
        variant="ghost"
        className="h-11 rounded-xl font-semibold text-urgent hover:bg-urgent-soft hover:text-urgent"
        onClick={() => setConfirmCancel(true)}
      >
        Batalkan pesanan
      </Button>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        destructive
        icon={<XCircleIcon className="size-7" />}
        title="Batalkan pesanan?"
        description="Porsi yang sudah dikunci akan dikembalikan ke warung dan bisa dipesan orang lain."
        confirmLabel="Ya, batalkan"
        cancelLabel="Kembali"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />

      <Dialog open={timesUp && !timesUpDismissed} onOpenChange={(o) => !o && setTimesUpDismissed(true)}>
        <DialogContent showCloseButton={false} className="max-w-[calc(100%-2rem)] rounded-3xl p-6 text-center sm:max-w-sm">
          <DialogHeader className="items-center text-center sm:text-center">
            <span className="mb-1 inline-flex size-16 items-center justify-center rounded-3xl bg-urgent-soft text-urgent">
              <TimerOffIcon className="size-8" />
            </span>
            <DialogTitle className="text-lg font-bold">Waktu pembayaran habis</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Pembayaran belum kami terima dalam 10 menit, jadi porsi yang dikunci sudah dilepas. Kalau masih ada stok,
              kamu bisa pesan ulang.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 grid gap-2">
            <Button asChild className="h-11 rounded-xl font-semibold">
              <Link href={`/warung/${order.merchant.slug}`}>Pesan ulang di {order.merchant.name}</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-xl">
              <Link href="/discover">Cari makanan lain</Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
