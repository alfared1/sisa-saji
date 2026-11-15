"use client";

import { useId, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MerchantBatchView } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { maxDiscountForFloor, priceForDiscount } from "../lib/logic";

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

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saving) onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-3xl p-6 sm:max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle className="text-lg font-bold">Ubah diskon</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {batch.menu_name}. Harga otomatis dimatikan supaya harganya tetap seperti yang kamu pilih.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl bg-surface p-4 ring-1 ring-border">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={sliderId} className="text-sm font-semibold">
              Diskon
            </label>
            <span className="text-2xl font-extrabold tabular-nums">{pct}%</span>
          </div>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={max}
            step={1}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="mt-2 h-11 w-full accent-[var(--primary)]"
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
