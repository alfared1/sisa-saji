"use client";

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiClientError, api } from "@/lib/api/client";
import { MERCHANT_TICKET_CANCEL_REASONS, noShowCancelOpensAt, type MerchantTicketCancelReason } from "@/lib/constants";
import type { OrderDetail, OrderResponse } from "@/lib/contracts";
import { formatClockId } from "@/lib/time";
import { cn } from "@/lib/utils";
import { merchantKeys } from "../lib/queries";

const HINTS: Record<MerchantTicketCancelReason, string> = {
  NO_SHOW: "Porsinya kembali ke stok dan bisa dipesan pembeli lain. Dihitung sebagai tiket tidak diambil pembeli.",
  OUT_OF_STOCK: "Sisa stok menu ini di aplikasi jadi 0, supaya tidak dipesan orang lain.",
};
const REASONS = Object.keys(MERCHANT_TICKET_CANCEL_REASONS) as MerchantTicketCancelReason[];

/** Open, unpaid "bayar di warung" ticket the warung may still cancel. */
export function isCancellableTicket(order: Pick<OrderDetail, "status" | "payment_method" | "paid_at">): boolean {
  return order.status === "READY_FOR_PICKUP" && order.payment_method === "BAYAR_DI_WARUNG" && !order.paid_at;
}

/**
 * "Batalkan tiket" for a pilot warung: the buyer did not come, or the food ran out. A
 * confirmation dialog asks for the reason; the buyer's ticket then shows it.
 */
export function CancelTicketButton({ order, className }: { order: OrderDetail; className?: string }) {
  const qc = useQueryClient();
  const name = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<MerchantTicketCancelReason | null>(null);
  // "Tidak datang" only near the end of the hold (the server checks the same rule).
  const [openedAt, setOpenedAt] = useState(0);
  const noShowFrom = noShowCancelOpensAt(order.created_at, order.pickup_deadline_at);
  const noShowLocked = openedAt < noShowFrom.getTime();

  const cancel = useMutation({
    mutationFn: (r: MerchantTicketCancelReason) =>
      api.post<OrderResponse>(`/merchant/orders/${order.id}/cancel`, { reason: r }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: merchantKeys.ordersAll });
      void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
      setOpen(false);
      setReason(null);
      toast("Tiket dibatalkan", { description: `${order.order_number}. Pembeli melihat tiketnya dibatalkan warung.` });
    },
    onError: (err) => {
      setOpen(false);
      setReason(null);
      void qc.invalidateQueries({ queryKey: merchantKeys.ordersAll });
      toast.error(err instanceof ApiClientError ? err.message : "Gagal membatalkan tiket. Coba lagi.");
    },
  });

  const onOpenChange = (o: boolean) => {
    if (cancel.isPending) return;
    setOpen(o);
    if (!o) setReason(null);
  };

  return (
    <>
      <Button
        variant="ghost"
        className={cn("h-10 rounded-xl px-3 text-sm font-semibold text-urgent hover:bg-urgent-soft hover:text-urgent", className)}
        onClick={() => {
          setOpenedAt(Date.now());
          setOpen(true);
        }}
      >
        Batalkan tiket
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          role="alertdialog"
          showCloseButton={false}
          className="max-w-[calc(100%-2rem)] rounded-3xl p-6 sm:max-w-sm"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg font-bold">Batalkan tiket ini?</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {order.customer.full_name} · {order.order_number}. Pembeli akan melihat bahwa warung membatalkan tiketnya.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Alasannya</legend>
            {REASONS.map((r) => {
              const locked = r === "NO_SHOW" && noShowLocked;
              return (
                <label
                  key={r}
                  className={cn(
                    "flex items-start gap-3 rounded-xl p-3 ring-1 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                    locked ? "cursor-not-allowed bg-muted/50 ring-border" : "cursor-pointer",
                    !locked && (reason === r ? "bg-urgent-soft ring-urgent/40" : "bg-card ring-border hover:bg-muted"),
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    disabled={cancel.isPending || locked}
                    className="mt-0.5 size-4 shrink-0 accent-urgent"
                  />
                  <span className={cn("min-w-0", locked && "opacity-70")}>
                    <span className="block text-sm font-semibold">{MERCHANT_TICKET_CANCEL_REASONS[r].label}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {locked
                        ? `Bisa dipilih mulai jam ${formatClockId(noShowFrom)}. Sampai jam ${formatClockId(order.pickup_deadline_at)} porsinya masih milik pembeli.`
                        : HINTS[r]}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <DialogFooter className="mx-0 mt-2 mb-0 grid grid-cols-2 gap-2 rounded-none border-t-0 bg-transparent p-0 sm:flex-none">
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => onOpenChange(false)} disabled={cancel.isPending}>
              Kembali
            </Button>
            <Button
              className="h-11 rounded-xl bg-urgent text-urgent-foreground hover:bg-urgent/90"
              onClick={() => reason && cancel.mutate(reason)}
              disabled={reason === null || cancel.isPending}
            >
              {cancel.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              Ya, batalkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
