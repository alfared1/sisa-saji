"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "motion/react";
import { AlertTriangleIcon, ClipboardListIcon, KeyboardIcon, Loader2Icon, PackageCheckIcon } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { ApiClientError, api } from "@/lib/api/client";
import type { OrderDetail, OrderResponse } from "@/lib/contracts";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { parsePickupCode, pickupPayload, sanitizePinInput } from "../lib/logic";
import { merchantKeys } from "../lib/queries";
import { MerchantPage, MerchantPageHeader } from "../ui";
import { OrderVerificationPanel, VerificationPlaceholder, VerificationSuccess } from "./order-verification";
import { QrScanner } from "./qr-scanner";

type Stage = { kind: "idle" } | { kind: "review"; order: OrderDetail; code: string } | { kind: "done"; order: OrderDetail };

/** Friendly Indonesian copy for the pickup error codes. */
export function pickupErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case "INVALID_PICKUP_CODE":
        return "Kode tidak ditemukan. Pastikan pembeli menunjukkan tiket aktif dari warung ini.";
      case "ORDER_STATE_CONFLICT":
        return "Pesanan ini sudah diambil sebelumnya (atau statusnya berubah).";
      case "PICKUP_WINDOW_CLOSED":
        return "Batas waktu pengambilan sudah lewat. Hubungi pembeli lewat WhatsApp bila perlu.";
      case "NOT_FOUND":
        return "Pesanan tidak ditemukan di warung ini.";
      default:
        return err.message;
    }
  }
  return "Gagal memeriksa kode. Coba lagi.";
}

/** /merchant/orders/scan — QR / PIN Pickup Validator. */
export function PickupScanView() {
  const qc = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [recent, setRecent] = useState<OrderDetail[]>([]);
  const pinRef = useRef<HTMLInputElement>(null);

  const lookup = useMutation({
    mutationFn: (code: string) => api.post<OrderResponse>("/orders/lookup-pickup", { pickup_code_or_qr_token: code }),
  });
  const verify = useMutation({
    mutationFn: ({ id, code }: { id: string; code: string }) =>
      api.post<OrderResponse>(`/orders/${id}/verify-pickup`, { pickup_code_or_qr_token: code }),
  });

  const fail = useCallback((message: string) => {
    setInlineError(message);
    setShake((n) => n + 1);
    setPin("");
    requestAnimationFrame(() => pinRef.current?.focus());
  }, []);

  const check = useCallback(
    (raw: string, source: "pin" | "camera") => {
      const parsed = parsePickupCode(raw);
      if (!parsed) {
        const msg = source === "camera" ? "QR ini bukan tiket Sisa-Saji." : "Masukkan 4 digit kode, contoh SJ-4829.";
        if (source === "camera") toast.error(msg, { id: "scan-invalid" });
        fail(msg);
        return;
      }
      if (lookup.isPending) return;
      setInlineError(null);
      const code = pickupPayload(parsed);
      lookup.mutate(code, {
        onSuccess: ({ order }) => setStage({ kind: "review", order, code }),
        onError: (err) => {
          const msg = pickupErrorMessage(err);
          if (source === "camera") toast.error(msg, { id: "scan-error" });
          fail(msg);
        },
      });
    },
    [fail, lookup],
  );

  const complete = () => {
    if (stage.kind !== "review") return;
    verify.mutate(
      { id: stage.order.id, code: stage.code },
      {
        onSuccess: ({ order }) => {
          setStage({ kind: "done", order });
          setRecent((r) => [order, ...r.filter((o) => o.id !== order.id)].slice(0, 5));
          toast.success(`Pesanan ${order.order_number} selesai`, { description: `+${formatIdr(order.net_merchant_payout_idr)} masuk ke saldo warung.` });
          void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
          void qc.invalidateQueries({ queryKey: merchantKeys.ordersAll });
          void qc.invalidateQueries({ queryKey: merchantKeys.me });
        },
        onError: (err) => {
          toast.error(pickupErrorMessage(err));
          setStage({ kind: "idle" });
          fail(pickupErrorMessage(err));
        },
      },
    );
  };

  const reset = () => {
    setStage({ kind: "idle" });
    setPin("");
    setInlineError(null);
    verify.reset();
    lookup.reset();
    requestAnimationFrame(() => pinRef.current?.focus());
  };

  const panel =
    stage.kind === "review" ? (
      <OrderVerificationPanel order={stage.order} completing={verify.isPending} onComplete={complete} onCancel={reset} />
    ) : stage.kind === "done" ? (
      <VerificationSuccess order={stage.order} onNext={reset} />
    ) : null;

  return (
    <MerchantPage>
      <MerchantPageHeader
        title="Scan & verifikasi"
        subtitle="Pindai QR tiket atau ketik kode SJ- dari pembeli."
        actions={
          <Link
            href="/merchant/orders"
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-card px-4 text-sm font-semibold ring-1 ring-border hover:bg-muted"
          >
            <ClipboardListIcon className="size-4" /> Pesanan
          </Link>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          <QrScanner paused={stage.kind !== "idle" || lookup.isPending} onDecode={(t) => check(t, "camera")} className="mx-auto max-w-md lg:max-w-none" />

          <section aria-labelledby="pin-heading" className="mx-auto max-w-md rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border sm:p-5 lg:max-w-none">
            <h2 id="pin-heading" className="flex items-center gap-2 text-base font-bold">
              <KeyboardIcon className="size-4 text-primary" aria-hidden /> Ketik kode pengambilan
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">4 digit di tiket pembeli. Otomatis diperiksa saat lengkap.</p>
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (pin.length === 4) check(pin, "pin");
              }}
            >
              <motion.div
                key={shake}
                animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : undefined}
                transition={{ duration: 0.4 }}
                className="flex items-center justify-center gap-2"
              >
                <span className="text-3xl font-extrabold text-muted-foreground" aria-hidden>
                  SJ-
                </span>
                <InputOTP
                  ref={pinRef}
                  maxLength={4}
                  value={pin}
                  inputMode="numeric"
                  pattern="^[0-9]*$"
                  autoComplete="off"
                  aria-label="Kode pengambilan 4 digit"
                  pasteTransformer={sanitizePinInput}
                  onChange={(v) => {
                    setPin(sanitizePinInput(v));
                    if (inlineError) setInlineError(null);
                  }}
                  onComplete={(v: string) => check(v, "pin")}
                  disabled={lookup.isPending}
                >
                  <InputOTPGroup className="gap-2">
                    {[0, 1, 2, 3].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        aria-invalid={inlineError ? true : undefined}
                        className="size-14 rounded-2xl! border! bg-surface text-3xl font-extrabold tabular-nums first:rounded-2xl last:rounded-2xl sm:size-16"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </motion.div>

              <div className="mt-3 min-h-6 text-center" aria-live="polite">
                {lookup.isPending ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" /> Memeriksa kode…
                  </span>
                ) : inlineError ? (
                  <span role="alert" className="inline-flex items-start gap-1.5 text-left text-sm font-semibold text-urgent">
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" /> {inlineError}
                  </span>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={pin.length !== 4 || lookup.isPending}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-sm font-bold text-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
              >
                Periksa kode
              </button>
            </form>
          </section>

          {recent.length > 0 && (
            <section aria-labelledby="recent-heading" className="mx-auto max-w-md lg:max-w-none">
              <h2 id="recent-heading" className="mb-2 text-sm font-bold text-muted-foreground">
                Baru diverifikasi
              </h2>
              <ul className="space-y-2">
                {recent.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
                    <PackageCheckIcon className="size-5 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {o.customer.full_name} <span className="font-normal text-muted-foreground">· {o.order_number}</span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{o.picked_up_at ? formatClockId(o.picked_up_at) : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {isDesktop ? (
          <aside className={cn("sticky top-6 rounded-3xl bg-card p-5 shadow-card ring-1 ring-border", stage.kind === "done" && "ring-2 ring-primary")} aria-label="Verifikasi pesanan">
            {panel ?? <VerificationPlaceholder />}
          </aside>
        ) : (
          <Sheet open={stage.kind !== "idle"} onOpenChange={(o) => !o && !verify.isPending && reset()}>
            <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="mx-auto mt-1 h-1.5 w-12 rounded-full bg-muted" aria-hidden />
              <SheetHeader className="px-0 pb-0">
                <SheetTitle className="text-lg font-extrabold">{stage.kind === "done" ? "Berhasil diverifikasi" : "Verifikasi pesanan"}</SheetTitle>
                <SheetDescription>{stage.kind === "done" ? "Saldo & dampak sudah tercatat." : "Cocokkan isi pesanan, lalu serahkan."}</SheetDescription>
              </SheetHeader>
              <div className="mx-auto w-full max-w-md">{panel}</div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </MerchantPage>
  );
}
