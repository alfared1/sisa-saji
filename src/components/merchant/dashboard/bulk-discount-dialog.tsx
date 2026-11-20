"use client";

import { useState } from "react";
import { Loader2Icon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MerchantBatchView } from "@/lib/contracts";
import { cn } from "@/lib/utils";

const PRESET_BULK_DISCOUNTS = [20, 30, 50, 70, 80] as const;

/**
 * "Obral semua menu sekaligus" dialog: allows the merchant to set a single
 * closing discount across all currently active menu batches with one click.
 */
export function BulkDiscountDialog({
  batches,
  open,
  onOpenChange,
  saving,
  onApply,
}: {
  batches: MerchantBatchView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onApply: (pct: number) => void;
}) {
  const [pct, setPct] = useState(50);
  const activeBatches = batches.filter((b) => b.status === "ACTIVE" || b.status === "SCHEDULED");

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
            <ZapIcon className="size-5 text-deal" aria-hidden />
            Obral semua menu ({activeBatches.length} menu)
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Pasang diskon tutup toko untuk semua porsi menu yang sedang tayang sekaligus.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl bg-surface p-4 ring-1 ring-border">
          <div className="flex items-baseline justify-between gap-3">
            <label className="text-sm font-semibold">Besaran diskon</label>
            <span className="text-2xl font-extrabold tabular-nums text-deal">{pct}%</span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {PRESET_BULK_DISCOUNTS.map((d) => {
              const selected = pct === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPct(d)}
                  className={cn(
                    "h-8 rounded-lg px-2.5 text-xs font-semibold tabular-nums transition-colors",
                    selected
                      ? "bg-deal text-deal-foreground shadow-sm"
                      : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground ring-1 ring-border/70",
                  )}
                >
                  {d}%
                </button>
              );
            })}
          </div>

          <input
            type="range"
            min={10}
            max={85}
            step={5}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="mt-3 h-11 w-full accent-[var(--primary)]"
            aria-valuetext={`${pct} persen diskon untuk semua menu`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Diskon otomatis disesuaikan agar tidak berada di bawah harga minimum per menu.
          </p>
        </div>

        <DialogFooter className="mx-0 mt-2 mb-0 grid grid-cols-2 gap-2 rounded-none border-t-0 bg-transparent p-0 sm:flex-none">
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button
            className="h-11 rounded-xl bg-deal text-deal-foreground hover:bg-deal/90"
            onClick={() => onApply(pct)}
            disabled={saving || activeBatches.length === 0}
          >
            {saving && <Loader2Icon className="animate-spin" aria-hidden />}
            Terapkan ({pct}%)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
