"use client";

/**
 * "Geser jam": the core of the product in one card. Moving the slider from 19.30 to 21.45 runs
 * the real pricing rules (calculateOptimalRecoveryPrice) for an example menu closing at 22.00,
 * so the visitor sees the price fall, why it lands where it does, and that it stops at the
 * warung's minimum. An illustration labelled "Contoh", never live data.
 */
import { useId, useState } from "react";
import { DiscountBadge } from "@/components/common/discount-badge";
import { EVENING_EXAMPLE } from "@/lib/pricing/evening-example";
import { calculateOptimalRecoveryPrice } from "@/lib/pricing/dynamic-discount";
import { PRICE_ROUNDING_IDR } from "@/lib/constants";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";

const CLOSE_MIN = 22 * 60;
const START_MIN = 19 * 60 + 30;
const END_MIN = 21 * 60 + 45;
const STEP_MIN = 15;
const PORTIONS = 6;

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}.${String(m % 60).padStart(2, "0")}`;
const pad = (n: number) => String(n).padStart(2, "0");

function quoteAt(minuteOfDay: number) {
  return calculateOptimalRecoveryPrice({
    originalPriceIdr: EVENING_EXAMPLE.priceIdr,
    minRecoveryPriceIdr: EVENING_EXAMPLE.floorIdr,
    availableStock: PORTIONS,
    minutesToClose: CLOSE_MIN - minuteOfDay,
    activeUsersIn2km: 20,
  });
}

/** Consecutive slider stops with the same price, e.g. "Sampai 20.59 · Rp 11.000", "Mulai 21.00 · Rp 10.000". */
function priceBands() {
  const bands: { from: number; to: number; price: number; pct: number; floor: boolean }[] = [];
  for (let m = START_MIN; m <= END_MIN; m += STEP_MIN) {
    const q = quoteAt(m);
    const last = bands.at(-1);
    if (last && last.price === q.recommendedSellingPriceIdr) last.to = m + STEP_MIN - 1;
    else bands.push({ from: m, to: m + STEP_MIN - 1, price: q.recommendedSellingPriceIdr, pct: q.ruleDiscountPct, floor: q.floorApplied });
  }
  return bands;
}

/** The bands are the same for every visitor: computed once. */
const BANDS = priceBands();

export function PriceSliderCard({ className }: { className?: string }) {
  const id = useId();
  const [at, setAt] = useState(START_MIN);
  const q = quoteAt(at);
  const left = CLOSE_MIN - at;
  const raw = (EVENING_EXAMPLE.priceIdr * (100 - q.ruleDiscountPct)) / 100;
  const rounded = Math.ceil(raw / PRICE_ROUNDING_IDR) * PRICE_ROUNDING_IDR;

  return (
    <section aria-labelledby={`${id}-t`} className={cn("rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-t`} className="text-lg leading-snug font-bold">
            {EVENING_EXAMPLE.name}
          </h2>
          <p className="text-sm text-muted-foreground">Warung contoh · {PORTIONS} porsi · tutup 22.00</p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">Contoh</span>
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-3" aria-live="polite">
        <span className="text-5xl leading-none font-extrabold text-deal tabular-nums">{formatIdr(q.recommendedSellingPriceIdr)}</span>
        <span className="text-base text-muted-foreground tabular-nums line-through">{formatIdr(EVENING_EXAMPLE.priceIdr)}</span>
      </p>
      <span aria-hidden className="mt-2 block h-1 w-12 rounded-full bg-plate" />
      <div className="mt-3">
        <DiscountBadge pct={q.recommendedDiscountPct} minutesToClose={left} size="md" />
      </div>
      <p className="mt-3 font-bold tabular-nums">
        Tutup dalam {pad(Math.floor(left / 60))}:{pad(left % 60)}:00
      </p>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${id}-r`} className="text-sm font-semibold">
            Geser jam
          </label>
          <span className="text-sm font-bold tabular-nums">Pukul {clock(at)}</span>
        </div>
        <input
          id={`${id}-r`}
          type="range"
          min={START_MIN}
          max={END_MIN}
          step={STEP_MIN}
          value={at}
          onChange={(e) => setAt(Number(e.target.value))}
          aria-valuetext={`Pukul ${clock(at)}, harga ${formatIdr(q.recommendedSellingPriceIdr)}`}
          className="mt-2 h-11 w-full cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums" aria-hidden>
          <span>{clock(START_MIN)}</span>
          <span>{clock(END_MIN)}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Geser ke kanan, lihat harga turun saat warung makin dekat tutup.</p>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Harga per jam">
        {BANDS.map((b, i) => {
          const active = at >= b.from && at <= b.to;
          const when = i === 0 ? `Sampai ${clock(b.to)}` : `Mulai ${clock(b.from)}`;
          return (
            <li
              key={b.from}
              className={cn(
                "flex items-start justify-between gap-2 rounded-xl px-3 py-2.5 text-sm ring-1",
                active ? "bg-brand-soft ring-primary/40" : "bg-card ring-border",
              )}
            >
              <span>
                {when}
                <span className="block text-xs text-muted-foreground">{b.floor ? "harga minimum warung" : `potongan ${b.pct}%`}</span>
              </span>
              <span className="font-extrabold whitespace-nowrap text-deal tabular-nums">{formatIdr(b.price)}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t border-border pt-3 text-sm leading-relaxed">
        <p className="text-muted-foreground">
          Sisa {left} menit, {PORTIONS} porsi: potongan {q.ruleDiscountPct}% dari {formatIdr(EVENING_EXAMPLE.priceIdr)} ={" "}
          {formatIdr(rounded)}
          {rounded !== raw && " (dibulatkan ke atas ke Rp 500 terdekat)"}
          {q.floorApplied ? `, naik ke harga minimum warung ${formatIdr(EVENING_EXAMPLE.floorIdr)}.` : "."}
        </p>
        <p className="mt-1 font-semibold">Harga tidak pernah di bawah harga minimum warung.</p>
      </div>
    </section>
  );
}
