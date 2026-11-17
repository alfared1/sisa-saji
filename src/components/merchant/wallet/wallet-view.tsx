"use client";

/**
 * /merchant/saldo — the warung's balance, where payouts go, "Cairkan" and the last 30 days of
 * money in (collected orders) and out (payouts).
 */
import { useId, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon, ReceiptTextIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState, errorMessage } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api/client";
import type { PayoutRequestBody, PayoutResponse, PayoutStatus, WalletEntry, WalletResponse } from "@/lib/contracts";
import { formatClockId, formatIdr, wibDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { formatDateLabel } from "../orders/orders-view";
import { merchantKeys, useMerchantReady } from "../lib/queries";
import { FieldError, MerchantPage, MerchantPageHeader, MoneyInput, SectionCard } from "../ui";

const PAYOUT_LABEL: Record<PayoutStatus, { text: string; cls: string }> = {
  PROCESSING: { text: "Diproses", cls: "bg-warning-soft text-amber-900 dark:text-amber-100" },
  PAID: { text: "Terkirim", cls: "bg-brand-soft text-primary" },
  FAILED: { text: "Gagal", cls: "bg-urgent-soft text-urgent" },
};

function PayoutDialog({ wallet, open, onOpenChange }: { wallet: WalletResponse; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const isDemo = useSession().user?.is_demo ?? false;
  const inputId = useId();
  const errId = useId();
  const hintId = useId();
  const [amount, setAmount] = useState<number | null>(wallet.balance_idr);
  const tooSmall = amount !== null && amount < wallet.min_payout_idr;
  const tooBig = amount !== null && amount > wallet.balance_idr;
  const error = tooBig ? `Melebihi saldo ${formatIdr(wallet.balance_idr)}` : tooSmall ? "Jumlahnya di bawah batas minimal." : null;

  const pay = useMutation({
    mutationFn: (amount_idr: number) => api.post<PayoutResponse>("/merchant/wallet/payouts", { amount_idr } satisfies PayoutRequestBody),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: merchantKeys.wallet });
      void qc.invalidateQueries({ queryKey: merchantKeys.me });
      onOpenChange(false);
      toast.success(res.payout.status === "PAID" ? "Saldo terkirim" : "Pencairan diproses", {
        description: `${formatIdr(res.payout.amount_idr)} ke ${res.payout.bank_code} ${res.payout.account_masked}${
          res.payout.simulated ? " (simulasi)" : ""
        }.`,
      });
    },
    onError: (err) => toast.error(errorMessage(err, "Pencairan gagal. Coba lagi.")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !pay.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-3xl p-6 sm:max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle className="text-lg font-bold">Cairkan saldo</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Ke {wallet.destination?.bank_code} {wallet.destination?.account_masked}
            {wallet.destination?.holder ? ` a.n. ${wallet.destination.holder}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={inputId} className="text-sm font-semibold">
          Jumlah
        </label>
        <MoneyInput id={inputId} value={amount} onChange={setAmount} invalid={Boolean(error)} describedBy={`${hintId} ${errId}`} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5 pt-1">
            {/* Always visible, not only once the amount is too small. */}
            <p id={hintId} className="text-xs text-muted-foreground tabular-nums">
              Minimal {formatIdr(wallet.min_payout_idr)}
            </p>
            <FieldError id={errId}>{error}</FieldError>
          </div>
          <button
            type="button"
            onClick={() => setAmount(wallet.balance_idr)}
            className="ml-auto h-9 rounded-full px-3 text-xs font-semibold text-primary outline-none hover:bg-brand-soft focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Semua saldo
          </button>
        </div>
        {(wallet.simulated || isDemo) && (
          <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            {isDemo
              ? "Akun demo: simulasi, dan saldo tidak berkurang supaya pengunjung lain tetap bisa mencoba."
              : "Simulasi: tidak ada uang sungguhan yang dikirim."}
          </p>
        )}
        <DialogFooter className="mx-0 mt-2 mb-0 grid grid-cols-2 gap-2 rounded-none border-t-0 bg-transparent p-0 sm:flex-none">
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
            Batal
          </Button>
          <Button className="h-11 rounded-xl" disabled={!amount || Boolean(error) || pay.isPending} onClick={() => amount && pay.mutate(amount)}>
            {pay.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Cairkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryRow({ e }: { e: WalletEntry }) {
  const out = e.amount_idr < 0;
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{e.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {formatClockId(e.at)}
          {e.order_number ? ` · ${e.order_number}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={cn("text-sm font-extrabold tabular-nums", out ? "text-foreground/70" : "text-foreground")}>
          {out ? "−" : "+"}
          {formatIdr(Math.abs(e.amount_idr))}
        </span>
        {e.payout_status && (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", PAYOUT_LABEL[e.payout_status].cls)}>
            {PAYOUT_LABEL[e.payout_status].text}
          </span>
        )}
      </div>
    </li>
  );
}

const HISTORY_STEP = 15;

export function MerchantWalletView() {
  const ready = useMerchantReady();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(HISTORY_STEP);
  const q = useQuery({
    queryKey: merchantKeys.wallet,
    queryFn: () => api.get<WalletResponse>("/merchant/wallet"),
    enabled: ready,
  });
  // Client clock only after mount (prerender must not read the time).
  const now = useNow(60_000);
  const today = now !== null ? wibDate(new Date(now)) : "";

  return (
    <MerchantPage>
      <MerchantPageHeader
        title="Saldo warung"
        backHref="/merchant/dashboard"
        subtitle="Uang dari pesanan yang dibayar online, masuk saat pesanan diambil atau lewat batas tanpa diambil. Uang tunai yang dibayar di warung tidak masuk saldo."
      />
      {q.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-72 rounded-3xl" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-6">
          <section aria-label="Saldo" className="rounded-3xl bg-card p-5 shadow-soft ring-1 ring-border">
            <p className="text-sm font-semibold text-muted-foreground">Saldo sekarang</p>
            <p className="mt-1 text-4xl leading-none font-extrabold tabular-nums">{formatIdr(q.data.balance_idr)}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {q.data.destination ? (
                <>
                  Dicairkan ke <b className="text-foreground">{q.data.destination.bank_code}</b>{" "}
                  <span className="tabular-nums">{q.data.destination.account_masked}</span>
                  {q.data.destination.holder ? ` a.n. ${q.data.destination.holder}` : ""}.{" "}
                </>
              ) : null}
              <Link href="/merchant/settings" className="font-semibold text-primary underline-offset-2 hover:underline">
                Ubah rekening
              </Link>
            </p>
            <Button className="mt-4 h-12 w-full rounded-xl text-base font-semibold" disabled={Boolean(q.data.payout_blocked_reason)} onClick={() => setOpen(true)}>
              Cairkan
            </Button>
            {q.data.payout_blocked_reason && <p className="mt-2 text-xs text-muted-foreground">{q.data.payout_blocked_reason}</p>}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {q.data.simulated
                ? "Mode demo: pencairan disimulasikan, tidak ada uang sungguhan yang dikirim."
                : "Pencairan diproses tim paling lambat 1×24 jam ke rekeningmu."}
            </p>
            {open && <PayoutDialog wallet={q.data} open={open} onOpenChange={setOpen} />}
          </section>

          <SectionCard title="Riwayat 30 hari" icon={ReceiptTextIcon} description="Uang masuk dari pesanan dan uang keluar ke rekening.">
            {q.data.entries.length === 0 ? (
              <EmptyState icon={ReceiptTextIcon} title="Belum ada riwayat" description="Begitu pembeli mengambil pesanan yang dibayar online, uangnya tercatat di sini." />
            ) : (
              <div className="space-y-4">
                {groupEntries(q.data.entries.slice(0, shown)).map(([date, list]) => (
                  <section key={date} aria-label={formatDateLabel(date, today)}>
                    <h3 className="text-xs font-semibold text-muted-foreground">{formatDateLabel(date, today)}</h3>
                    <ul className="divide-y divide-border">
                      {list.map((e, i) => (
                        <EntryRow key={`${e.at}-${i}`} e={e} />
                      ))}
                    </ul>
                  </section>
                ))}
                {q.data.entries.length > shown && (
                  <Button variant="outline" className="h-11 w-full rounded-xl font-semibold" onClick={() => setShown((n) => n + HISTORY_STEP)}>
                    Tampilkan lebih banyak
                  </Button>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </MerchantPage>
  );
}

function groupEntries(entries: WalletEntry[]): [string, WalletEntry[]][] {
  const map = new Map<string, WalletEntry[]>();
  for (const e of entries) {
    const d = wibDate(new Date(e.at));
    map.set(d, [...(map.get(d) ?? []), e]);
  }
  return [...map.entries()];
}
