"use client";

import { useId } from "react";
import { BrainCircuitIcon, Loader2Icon, ShieldCheckIcon, SlidersHorizontalIcon, UsersIcon, XIcon } from "lucide-react";
import { DISCOUNT_VARIANT_CLASS, DiscountBadge, discountBadgeState } from "@/components/common/discount-badge";
import { ErrorState } from "@/components/common/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { EscalationStep, QuoteAiResponse } from "@/lib/contracts";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { maxDiscountForFloor, priceForDiscount } from "../lib/logic";
import { ModelBadge } from "../ui";

/** Semicircle sell-out probability gauge. */
export function SelloutGauge({ probability, size = 148 }: { probability: number; size?: number }) {
  const p = Math.max(0, Math.min(1, probability));
  const r = 52;
  const arc = Math.PI * r;
  const tone = p >= 0.7 ? "var(--primary)" : p >= 0.4 ? "var(--warning)" : "var(--urgent)";
  const label = p >= 0.7 ? "Tinggi" : p >= 0.4 ? "Sedang" : "Rendah";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size * 0.62 }}>
      <svg viewBox="0 0 120 70" className="h-full w-full" role="img" aria-label={`Peluang habis terjual ${Math.round(p * 100)} persen (${label})`}>
        <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke="var(--muted)" strokeWidth="12" strokeLinecap="round" />
        <path
          d="M8 62 A52 52 0 0 1 112 62"
          fill="none"
          stroke={tone}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${arc * p} ${arc}`}
          style={{ transition: "stroke-dasharray 500ms cubic-bezier(.2,.8,.2,1), stroke 300ms" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-none">
        <span className="text-3xl font-extrabold tabular-nums">{Math.round(p * 100)}%</span>
        <span className="mt-1 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{label}</span>
      </div>
    </div>
  );
}

/** Mini bar chart of the auto-escalation schedule (50 % → 70 %). */
export function EscalationTimeline({ steps, endIso }: { steps: EscalationStep[]; endIso: string }) {
  if (!steps.length) return null;
  const maxPct = Math.max(70, ...steps.map((s) => s.discount_pct));
  return (
    <figure>
      <figcaption className="mb-2 text-xs font-bold text-muted-foreground">Kurva harga otomatis</figcaption>
      <ol className="flex items-end gap-1.5" aria-label="Jadwal diskon">
        {steps.map((s, i) => {
          // Same Hemat / Flash Rescue colours as the customer-facing badge (dev guide §7).
          const variant = discountBadgeState(s.discount_pct, s.minutes_to_close).variant;
          const h = 28 + (s.discount_pct / maxPct) * 56;
          return (
            <li key={s.time} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[11px] font-extrabold tabular-nums">{s.discount_pct}%</span>
              <span
                className={cn(
                  "flex w-full items-end justify-center rounded-t-lg rounded-b-sm pb-1 text-[10px] font-bold text-white tabular-nums transition-[height] duration-500",
                  DISCOUNT_VARIANT_CLASS[variant],
                  i === 0 && "ring-2 ring-foreground/80 ring-offset-2 ring-offset-card",
                )}
                style={{ height: h }}
                aria-hidden
              >
                {s.expected_remaining_stock > 0 ? s.expected_remaining_stock : ""}
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">{i === 0 ? "Kini" : formatClockId(s.time)}</span>
              <span className="sr-only">
                Pukul {formatClockId(s.time)}: diskon {s.discount_pct}%, harga {formatIdr(s.selling_price_idr)}, perkiraan sisa {s.expected_remaining_stock} porsi
              </span>
            </li>
          );
        })}
        <li className="flex w-9 shrink-0 flex-col items-center gap-1" aria-label={`Tutup pukul ${formatClockId(endIso)}`}>
          <span className="h-[84px] w-px border-l-2 border-dashed border-border" aria-hidden />
          <span className="text-[10px] font-bold text-urgent tabular-nums">{formatClockId(endIso)}</span>
        </li>
      </ol>
      <p className="mt-2 text-[11px] text-muted-foreground">Angka di batang = perkiraan porsi tersisa.</p>
    </figure>
  );
}

export function ManualOverride({
  quote,
  value,
  onChange,
}: {
  quote: QuoteAiResponse;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const id = useId();
  const max = maxDiscountForFloor(quote.original_price_idr, quote.min_recovery_price_idr);
  if (value === null) {
    return (
      <button
        type="button"
        onClick={() => onChange(Math.min(max, quote.recommended_discount_pct))}
        className="inline-flex h-11 items-center gap-2 rounded-full px-1 text-sm font-semibold text-foreground/80 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <SlidersHorizontalIcon className="size-4 text-primary" /> Atur diskon manual
      </button>
    );
  }
  const v = Math.min(value, max);
  const result = priceForDiscount(quote.original_price_idr, quote.min_recovery_price_idr, v);
  return (
    <div className="rounded-2xl bg-surface p-3 ring-1 ring-border">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-bold">
          Diskon manual
        </label>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3.5" /> Pakai rekomendasi AI
        </button>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={0}
          max={max}
          step={1}
          value={v}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-11 min-w-0 flex-1 accent-[var(--primary)]"
          aria-valuetext={`${v} persen, harga ${formatIdr(result.sellingPriceIdr)}`}
        />
        <span className="w-12 text-right text-lg font-extrabold tabular-nums">{v}%</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Harga jual <b className="text-foreground tabular-nums">{formatIdr(result.sellingPriceIdr)}</b>
        {result.floorApplied || v >= max ? ` · mentok di harga minimum ${formatIdr(quote.min_recovery_price_idr)}` : ""}
      </p>
    </div>
  );
}

function QuoteSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Menghitung rekomendasi">
      <div className="flex items-center gap-4">
        <Skeleton className="h-24 w-36 rounded-t-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-16 w-full rounded-2xl" />
    </div>
  );
}

/** Blueprint AIDiscountRecommendationCard (Surplus Prediction Engine + Dynamic Discount Optimizer). */
export function AiDiscountRecommendationCard({
  quote,
  isFetching,
  error,
  onRetry,
  disabledReason,
  override,
  onOverrideChange,
  endIso,
}: {
  quote: QuoteAiResponse | undefined;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  disabledReason: string | null;
  override: number | null;
  onOverrideChange: (v: number | null) => void;
  endIso: string | null;
}) {
  const effective =
    quote && override !== null ? priceForDiscount(quote.original_price_idr, quote.min_recovery_price_idr, override) : null;
  const price = effective?.sellingPriceIdr ?? quote?.recommended_selling_price_idr ?? 0;
  const pct = effective?.discountPct ?? quote?.recommended_discount_pct ?? 0;

  return (
    <section aria-labelledby="ai-card-title" aria-busy={isFetching} className="relative overflow-hidden rounded-3xl bg-card shadow-card ring-1 ring-border">
      <div className="h-1 w-full bg-gradient-to-r from-primary via-emerald-400 to-deal" aria-hidden />
      <header className="flex items-center justify-between gap-2 px-4 pt-4 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
            <BrainCircuitIcon className="size-4" aria-hidden />
          </span>
          <h2 id="ai-card-title" className="text-base font-bold">
            Rekomendasi AI
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          {isFetching && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground" role="status">
              <Loader2Icon className="size-3.5 animate-spin" /> Menghitung…
            </span>
          )}
          {quote && <ModelBadge version={quote.model_version} />}
        </div>
      </header>

      <div className="p-4 sm:p-5">
        {disabledReason ? (
          <p className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">{disabledReason}</p>
        ) : error && !quote ? (
          <ErrorState compact error={error} onRetry={onRetry} />
        ) : !quote ? (
          <QuoteSkeleton />
        ) : (
          <div className={cn("space-y-4 transition-opacity", isFetching && "opacity-70")}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <SelloutGauge probability={quote.sellout_probability} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-muted-foreground">
                  {override !== null ? "Harga manual kamu" : "Harga rekomendasi"}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="text-3xl leading-none font-extrabold tabular-nums">{formatIdr(price)}</span>
                  <DiscountBadge pct={pct} size="md" />
                </div>
                <p className="mt-1 text-sm text-muted-foreground tabular-nums line-through decoration-urgent/60">{formatIdr(quote.original_price_idr)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Peluang habis sebelum {endIso ? formatClockId(endIso) : "tutup"}
                </p>
              </div>
            </div>

            <p
              className={cn(
                "flex items-start gap-2 rounded-xl px-3 py-2 text-xs font-medium",
                quote.floor_applied ? "bg-warning-soft text-amber-800 dark:text-amber-200" : "bg-muted text-muted-foreground",
              )}
            >
              <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {quote.floor_applied
                ? `Harga lantai ${formatIdr(quote.min_recovery_price_idr)} diterapkan — diskon tidak turun di bawah modal kamu.`
                : `Tidak pernah di bawah harga minimum ${formatIdr(quote.min_recovery_price_idr)}.`}
            </p>

            {endIso && <EscalationTimeline steps={quote.escalation_schedule} endIso={endIso} />}

            <div className="flex items-center gap-2 rounded-2xl bg-sky-50 px-3 py-2.5 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              <UsersIcon className="size-4 shrink-0" aria-hidden />
              <span>
                <b className="tabular-nums">{quote.active_users_in_radius}</b> mahasiswa aktif dalam radius 2 km
              </span>
            </div>

            {quote.explanation.length > 0 && (
              <ul className="space-y-1.5 text-sm leading-snug text-foreground/85">
                {quote.explanation.map((e) => (
                  <li key={e} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            )}

            <ManualOverride quote={quote} value={override} onChange={onOverrideChange} />
          </div>
        )}
      </div>
    </section>
  );
}
