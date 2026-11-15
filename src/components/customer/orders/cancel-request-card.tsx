"use client";

/**
 * Paid online order (QRIS / e-wallet): the buyer can ask the warung to cancel it. The warung
 * decides (it may have set the portions aside); if it agrees, the payment is refunded in full.
 */
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, api } from "@/lib/api/client";
import { CANCEL_REQUEST_NOTE_MAX, CANCEL_REQUEST_REASONS, type CancelRequestReasonCode } from "@/lib/constants";
import type { CancelRequestBody, OrderDetail, OrderResponse } from "@/lib/contracts";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { customerKeys } from "../lib/queries";

const REASONS = Object.keys(CANCEL_REQUEST_REASONS) as CancelRequestReasonCode[];

/** Paid online and still waiting to be collected (cash tickets are cancelled directly). */
export function canRequestCancel(order: OrderDetail): boolean {
  return (
    (order.status === "PAID" || order.status === "READY_FOR_PICKUP") &&
    order.payment_method !== "BAYAR_DI_WARUNG" &&
    Boolean(order.paid_at)
  );
}

export function CancelRequestCard({ order }: { order: OrderDetail }) {
  const qc = useQueryClient();
  const name = useId();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancelRequestReasonCode | null>(null);
  const [note, setNote] = useState("");

  const send = useMutation({
    mutationFn: (body: CancelRequestBody) => api.post<OrderResponse>(`/orders/${order.id}/cancel-request`, body),
    onSuccess: (res) => {
      qc.setQueryData(customerKeys.order(order.id), res);
      void qc.invalidateQueries({ queryKey: customerKeys.ordersAll });
      setOpen(false);
      toast("Permintaan batal terkirim", { description: "Kami kabari begitu warung menjawab." });
    },
    onError: (err) => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: customerKeys.order(order.id) });
      toast.error(err instanceof ApiClientError ? err.message : "Gagal mengirim permintaan. Coba lagi.");
    },
  });

  const request = order.cancel_request ?? null;
  const noteNeeded = reason === "OTHER";
  const canSend = reason !== null && (!noteNeeded || note.trim().length > 0) && !send.isPending;

  if (request?.status === "PENDING") {
    return (
      <section aria-label="Permintaan batal" className="rounded-3xl bg-warning-soft p-4 ring-1 ring-warning/30" role="status">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Menunggu jawaban warung</p>
        <p className="mt-1 text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90">
          Kamu minta batal: {request.reason}. Sampai warung menjawab, pesananmu tetap berlaku.
        </p>
      </section>
    );
  }
  if (request?.status === "REJECTED") {
    return (
      <section aria-label="Permintaan batal" className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
        <p className="text-sm font-semibold">Warung menolak pembatalan</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {request.response ? `"${request.response}". ` : ""}Pesananmu tetap berlaku, ambil sebelum jam {formatClockId(order.pickup_deadline_at)}.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Batalkan pesanan" className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
      <p className="text-sm font-semibold">Tidak jadi mengambil?</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Minta warung membatalkan. Kalau disetujui,{" "}
        <span className="whitespace-nowrap">{formatIdr(order.total_customer_paid_idr)}</span> dikembalikan penuh.
      </p>
      <Button
        variant="ghost"
        className="mt-2 -ml-2 h-10 rounded-xl px-2 text-sm font-semibold text-urgent hover:bg-urgent-soft hover:text-urgent"
        onClick={() => setOpen(true)}
      >
        Minta batal
      </Button>

      <Dialog open={open} onOpenChange={(o) => !send.isPending && setOpen(o)}>
        <DialogContent className="max-w-[calc(100%-2rem)] rounded-3xl p-6 sm:max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg font-bold">Minta batal pesanan?</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Warung yang memutuskan, karena porsinya mungkin sudah disiapkan.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Alasannya</legend>
            {REASONS.map((r) => (
              <label
                key={r}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-1 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  reason === r ? "bg-urgent-soft ring-urgent/40" : "bg-card ring-border hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  disabled={send.isPending}
                  className="size-4 shrink-0 accent-urgent"
                />
                <span className="text-sm font-semibold">{CANCEL_REQUEST_REASONS[r]}</span>
              </label>
            ))}
          </fieldset>
          <label htmlFor={noteId} className="text-sm font-semibold">
            {noteNeeded ? "Ceritakan alasannya" : "Catatan untuk warung (boleh kosong)"}
          </label>
          <Textarea
            id={noteId}
            value={note}
            maxLength={CANCEL_REQUEST_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-16 rounded-xl"
          />
          <DialogFooter className="mx-0 mt-2 mb-0 grid grid-cols-2 gap-2 rounded-none border-t-0 bg-transparent p-0 sm:flex-none">
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => setOpen(false)} disabled={send.isPending}>
              Kembali
            </Button>
            <Button
              className="h-11 rounded-xl bg-urgent text-urgent-foreground hover:bg-urgent/90"
              onClick={() => reason && send.mutate({ reason, note: note.trim() || undefined })}
              disabled={!canSend}
            >
              {send.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              Kirim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Refund line on a cancelled paid order; says "simulasi" on demo payments. */
export function RefundNote({ order }: { order: OrderDetail }) {
  if (!order.refund) return null;
  return (
    <section aria-label="Pengembalian dana" className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Dana dikembalikan</p>
        <p className="text-lg font-extrabold tabular-nums">{formatIdr(order.refund.amount_idr)}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        Ke metode pembayaranmu · {order.refund.ref}
        {order.merchant.is_demo_data ? " · simulasi, tidak ada uang sungguhan" : ""}
      </p>
    </section>
  );
}
