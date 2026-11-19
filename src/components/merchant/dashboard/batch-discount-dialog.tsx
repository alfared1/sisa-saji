"use client";

import { useId, useState } from "react";
import { Loader2Icon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MerchantBatchView } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { maxDiscountForFloor, priceForDiscount } from "../lib/logic";

const PRESET_DISCOUNTS = [0, 20, 30, 50, 70, 80] as const;

/**
 * "Ubah diskon" on a live batch: the warung picks the discount itself. The price uses the same
 * rounding as the automatic price and never goes below the menu's minimum; auto discount turns
 * off so the price stays where the warung put it. Give it a key that changes with the batch's
 * price so the slider restarts from the saved discount.
 */
export function BatchDiscountDialog({
  batch,
  open,
  onOpenChange,
  saving,
  onSave,
}: {
  batch: MerchantBatchView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSave: (pct: number) => void;
}) {
  const sliderId = useId();
  const max = maxDiscountForFloor(batch.original_price_idr, batch.min_recovery_price_idr);
  const [pct, setPct] = useState(() => Math.min(batch.current_discount_pct, max));
  const result = priceForDiscount(batch.original_price_idr, batch.min_recovery_price_idr, pct);
  const atFloor = result.floorApplied || pct >= max;
  const isNormalPrice = batch.current_discount_pct === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saving) onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-3xl p-6 sm:max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            {isNormalPrice && <ZapIcon className="size-5 text-deal" aria-hidden />}
            {isNormalPrice ? "Pasang diskon tutup toko" : "Ubah diskon"}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {isNormalPrice
              ? `Atur diskon untuk ${batch.menu_name} agar sisa porsi cepat laku sebelum warung tutup.`
              : `${batch.menu_name}. Harga otomatis dimatikan supaya harganya tetap seperti yang kamu pilih.`}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl bg-surface p-4 ring-1 ring-border">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={sliderId} className="text-sm font-semibold">
              Pilihan diskon
            </label>
            <span className="text-2xl font-extrabold tabular-nums">{pct}%</span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {PRESET_DISCOUNTS.map((d) => {
              const clamped = Math.min(d, max);
              const selected = pct === clamped;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPct(clamped)}
                  className={cn(
                    "h-8 rounded-lg px-2.5 text-xs font-semibold tabular-nums transition-colors",
                    selected
                      ? "bg-deal text-deal-foreground shadow-sm"
                      : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground ring-1 ring-border/70",
                  )}
                >
                  {d === 0 ? "Normal (0%)" : `${d}%`}
                </button>
              );
            })}
          </div>

          <input
            id={sliderId}
            type="range"
            min={0}
            max={max}
            step={1}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="mt-3 h-11 w-full accent-[var(--primary)]"
            aria-valuetext={`${pct} persen, harga ${formatIdr(result.sellingPriceIdr)}`}
          />
          <p className="text-sm">
            Harga jual <b className="tabular-nums">{formatIdr(result.sellingPriceIdr)}</b>
            <span className="text-muted-foreground"> dari {formatIdr(batch.original_price_idr)}</span>
          </p>
          {atFloor && (
            <p className="mt-1 text-xs text-muted-foreground">
              Mentok di harga minimum {formatIdr(batch.min_recovery_price_idr)}.
            </p>
          )}
        </div>
        <DialogFooter className="mx-0 mt-2 mb-0 grid grid-cols-2 gap-2 rounded-none border-t-0 bg-transparent p-0 sm:flex-none">
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button className="h-11 rounded-xl" onClick={() => onSave(pct)} disabled={saving || pct === batch.current_discount_pct}>
            {saving && <Loader2Icon className="animate-spin" aria-hidden />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
