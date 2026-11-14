"use client";

import { useEffect, useId, useState } from "react";
import { motion } from "motion/react";
import {
  CameraIcon,
  CheckCircle2Icon,
  CloudIcon,
  LeafIcon,
  Loader2Icon,
  PackageCheckIcon,
  RecycleIcon,
  ScanLineIcon,
  TicketIcon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { Button } from "@/components/ui/button";
import type { OrderDetail } from "@/lib/contracts";
import { formatKg } from "@/lib/impact";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CustomerAvatar, OrderStatusPill, portionsOf } from "../orders/order-card";

/** Optional proof photo — previewed locally only, never uploaded. */
function ProofPhoto() {
  const inputId = useId();
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-muted-foreground">Foto bukti bungkusan (opsional)</p>
      {preview ? (
        <div className="relative overflow-hidden rounded-2xl ring-1 ring-border">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={preview} alt="Pratinjau foto bukti penyerahan" className="h-40 w-full object-cover" />
          <button
            type="button"
            onClick={() => setPreview(null)}
            aria-label="Hapus foto"
            className="absolute top-2 right-2 inline-flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur"
          >
            <XIcon className="size-4" />
          </button>
          <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-1 text-[11px] font-semibold text-white">Tersimpan di perangkat ini</span>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface text-sm font-semibold text-foreground/80 hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50"
        >
          <CameraIcon className="size-4 text-primary" /> Ambil foto bungkusan
        </label>
      )}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setPreview(URL.createObjectURL(f));
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Blueprint OrderVerificationSheet body + CompletePickupButton. */
export function OrderVerificationPanel({
  order,
  completing,
  onComplete,
  onCancel,
}: {
  order: OrderDetail;
  completing: boolean;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const portions = portionsOf(order);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CustomerAvatar name={order.customer.full_name} className="size-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-tight font-bold">{order.customer.full_name}</p>
          <p className="text-xs font-medium text-muted-foreground tabular-nums">{order.order_number}</p>
        </div>
        <OrderStatusPill status={order.status} />
      </div>

      <div className="rounded-2xl bg-surface p-3 ring-1 ring-border">
        <p className="mb-2 flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>Serahkan</span>
          <span className="tabular-nums">{portions} porsi</span>
        </p>
        <ul className="space-y-2">
          {order.items.map((i, idx) => (
            // One batch can appear on several lines (one per lauk), so the index is part of the key.
            <li key={`${idx}-${i.batch_id}`} className="flex items-center gap-3">
              <span className="inline-flex h-10 min-w-12 items-center justify-center rounded-xl bg-primary px-2 text-lg font-extrabold text-primary-foreground tabular-nums">
                {i.quantity}×
              </span>
              <span className="min-w-0 flex-1 text-base leading-snug font-semibold">
                {i.menu_name}
                {i.lauk && <span className="block text-sm font-medium text-muted-foreground">Lauk: {i.lauk}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {order.uses_own_lunchbox && (
        <p className="flex items-center gap-2 rounded-2xl bg-brand-soft px-3 py-2.5 text-sm font-semibold text-primary">
          <RecycleIcon className="size-5 shrink-0" aria-hidden /> Bawa wadah sendiri, tak perlu kemasan sekali pakai
        </p>
      )}

      {order.payment_method === "BAYAR_DI_WARUNG" && !order.paid_at && (
        <p className="rounded-2xl bg-deal-soft px-3 py-2.5 text-sm font-semibold text-deal">
          Tagih {formatIdr(order.total_customer_paid_idr)} dari pembeli (bayar di warung, tunai atau QRIS warung).
        </p>
      )}

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
          <dt className="text-xs text-muted-foreground">
            {order.payment_method === "BAYAR_DI_WARUNG" ? "Total ditagih" : "Total dibayar"}
          </dt>
          <dd className="text-base font-extrabold tabular-nums">{formatIdr(order.total_customer_paid_idr)}</dd>
          <dd className="text-[11px] text-muted-foreground">
            {order.payment_method === "BAYAR_DI_WARUNG"
              ? order.paid_at
                ? "Lunas di warung"
                : "Dibayar di warung saat ambil"
              : `Lunas · ${order.payment_method}`}
          </dd>
        </div>
        <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
          <dt className="text-xs text-muted-foreground">Batas ambil</dt>
          <dd className="text-base font-extrabold tabular-nums">{formatClockId(order.pickup_deadline_at)} WIB</dd>
          <dd className="mt-0.5">
            <CountdownBadge endIso={order.pickup_deadline_at} prefix="Sisa" overLabel="Lewat batas" variant="plain" />
          </dd>
        </div>
      </dl>

      <ProofPhoto />

      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button variant="outline" className="h-14 rounded-2xl px-4" onClick={onCancel} disabled={completing}>
          Batal
        </Button>
        <Button className="h-14 rounded-2xl text-base font-semibold" onClick={onComplete} disabled={completing}>
          {completing ? <Loader2Icon className="size-5 animate-spin" /> : <PackageCheckIcon className="size-5" />}
          {completing ? "Menyelesaikan…" : "Selesaikan Pesanan"}
        </Button>
      </div>
    </div>
  );
}

export function VerificationSuccess({ order, onNext }: { order: OrderDetail; onNext: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 text-center" role="status">
      <motion.span
        initial={{ scale: 0.3, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 15 }}
        className="mx-auto inline-flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <CheckCircle2Icon className="size-9" />
      </motion.span>
      <div>
        <p className="text-xl font-bold">Pesanan selesai!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {order.customer.full_name} · {order.order_number}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-left">
        <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
          <WalletIcon className="size-4 text-primary" aria-hidden />
          <p className="mt-1 text-sm font-extrabold tabular-nums">+{formatIdr(order.net_merchant_payout_idr)}</p>
          <p className="text-[11px] text-muted-foreground">
            {order.payment_method === "BAYAR_DI_WARUNG" ? "diterima langsung" : "ke saldo"}
          </p>
        </div>
        <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
          <LeafIcon className="size-4 text-primary" aria-hidden />
          <p className="mt-1 text-sm font-extrabold tabular-nums">{formatKg(order.food_saved_grams)}</p>
          <p className="text-[11px] text-muted-foreground">pangan</p>
        </div>
        <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
          <CloudIcon className="size-4 text-brand-strong" aria-hidden />
          <p className="mt-1 text-sm font-extrabold tabular-nums">{formatKg(order.co2_avoided_grams)}</p>
          <p className="text-[11px] text-muted-foreground">CO₂e dicegah</p>
        </div>
      </div>
      <Button autoFocus className="h-14 w-full rounded-2xl text-base font-semibold" onClick={onNext}>
        <ScanLineIcon className="size-5" /> Scan berikutnya
      </Button>
    </motion.div>
  );
}

export function VerificationPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-14 text-center", className)}>
      <span className="inline-flex size-14 items-center justify-center rounded-3xl bg-brand-soft text-primary">
        <TicketIcon className="size-6" />
      </span>
      <p className="text-base font-semibold">Belum ada tiket diperiksa</p>
      <p className="max-w-64 text-sm text-muted-foreground">Rincian pesanan yang harus diserahkan muncul di sini setelah QR dipindai atau kode diketik.</p>
    </div>
  );
}
