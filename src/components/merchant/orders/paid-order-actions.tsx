"use client";

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, api } from "@/lib/api/client";
import type { CancelRequestDecisionBody, OrderDetail, OrderResponse } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { merchantKeys } from "../lib/queries";

/** Paid online (QRIS / e-wallet) and still waiting to be collected. */
export function isPaidOnlineOpen(order: Pick<OrderDetail, "status" | "payment_method" | "paid_at">): boolean {
  return (
    (order.status === "PAID" || order.status === "READY_FOR_PICKUP") &&
    order.payment_method !== "BAYAR_DI_WARUNG" &&
    Boolean(order.paid_at)
  );
}

const REJECT_NOTES = ["Pesanan sudah disiapkan", "Porsinya sudah dibungkus", "Sebentar lagi warung tutup"];

function useOrderMutation<T>(path: string, onDone: (res: OrderResponse) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api.post<OrderResponse>(path, body),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: merchantKeys.ordersAll });
      void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
      onDone(res);
    },
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: merchantKeys.ordersAll });
      toast.error(err instanceof ApiClientError ? err.message : "Gagal menyimpan. Coba lagi.");
    },
  });
}

/** The buyer asked to cancel a paid order: approve (refund) or reject with a note. */
export function CancelRequestPanel({ order }: { order: OrderDetail }) {
  const noteId = useId();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");
  const decide = useOrderMutation<CancelRequestDecisionBody>(`/merchant/orders/${order.id}/cancel-request`, (res) => {
    setApproveOpen(false);
    setRejectOpen(false);
    setNote("");
    toast(res.order.status === "CANCELLED" ? "Pesanan dibatalkan" : "Permintaan batal ditolak", {
      description:
        res.order.status === "CANCELLED"
          ? `${formatIdr(order.total_customer_paid_idr)} dikembalikan ke pembeli.`
          : "Pembeli melihat alasanmu. Pesanannya tetap berlaku.",
    });
  });
  const request = order.cancel_request;
  if (!request || request.status !== "PENDING") return null;

  return (
    <div className="mt-2 rounded-xl bg-warning-soft p-3 ring-1 ring-warning/30" role="status">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Pembeli minta batal</p>
      <p className="mt-0.5 text-sm leading-snug text-amber-900/90 dark:text-amber-100/90">{request.reason}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-10 rounded-xl bg-card" onClick={() => setRejectOpen(true)} disabled={decide.isPending}>
          Tolak
        </Button>
        <Button className="h-10 rounded-xl" onClick={() => setApproveOpen(true)} disabled={decide.isPending}>
          Setujui
        </Button>
      </div>

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={(o) => !decide.isPending && setApproveOpen(o)}
        title="Setujui pembatalan?"
        description={`${formatIdr(order.total_customer_paid_idr)} dikembalikan ke ${order.customer.full_name}, dan porsinya kembali ke stok.`}
        confirmLabel="Ya, setujui"
        cancelLabel="Kembali"
        loading={decide.isPending}
        onConfirm={() => decide.mutate({ decision: "APPROVE" })}
      />

      <Dialog open={rejectOpen} onOpenChange={(o) => !decide.isPending && setRejectOpen(o)}>
        <DialogContent className="max-w-[calc(100%-2rem)] rounded-3xl p-6 sm:max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg font-bold">Tolak pembatalan?</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Pesanannya tetap berlaku. Tulis alasannya untuk pembeli.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {REJECT_NOTES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNote(n)}
                className={cn(
                  "h-9 rounded-full px-3 text-xs font-semibold ring-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  note === n ? "bg-primary text-primary-foreground ring-primary" : "bg-card ring-border hover:bg-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <label htmlFor={noteId} className="text-sm font-semibold">
            Alasan
          </label>
          <Textarea
            id={noteId}
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-20 rounded-xl"
          />
          <DialogFooter className="mx-0 mt-2 mb-0 grid grid-cols-2 gap-2 rounded-none border-t-0 bg-transparent p-0 sm:flex-none">
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => setRejectOpen(false)} disabled={decide.isPending}>
              Kembali
            </Button>
            <Button
              className="h-11 rounded-xl"
              onClick={() => decide.mutate({ decision: "REJECT", note: note.trim() })}
              disabled={!note.trim() || decide.isPending}
            >
              {decide.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A paid order whose food ran out: cancel with a full refund. */
export function OutOfStockCancelButton({ order, className }: { order: OrderDetail; className?: string }) {
  const [open, setOpen] = useState(false);
  const cancel = useOrderMutation<{ reason: "OUT_OF_STOCK" }>(`/merchant/orders/${order.id}/cancel`, () => {
    setOpen(false);
    toast("Pesanan dibatalkan", {
      description: `${formatIdr(order.total_customer_paid_idr)} dikembalikan ke pembeli.`,
    });
  });
  return (
    <>
      <Button
        variant="ghost"
        className={cn("h-10 rounded-xl px-3 text-sm font-semibold text-urgent hover:bg-urgent-soft hover:text-urgent", className)}
        onClick={() => setOpen(true)}
      >
        Stok habis
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => !cancel.isPending && setOpen(o)}
        destructive
        title="Batalkan karena stok habis?"
        description={`${formatIdr(order.total_customer_paid_idr)} dikembalikan ke ${order.customer.full_name}. Sisa stok menu ini di aplikasi jadi 0.`}
        confirmLabel="Ya, batalkan"
        cancelLabel="Kembali"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate({ reason: "OUT_OF_STOCK" })}
      />
    </>
  );
}
