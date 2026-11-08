"use client";

import { useState } from "react";
import type { AnalyticsResponse, InsightsResponse } from "@/lib/contracts";
import { DAY_NAMES_ID, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { HEATMAP_LEVELS, WEEK_ORDER, buildHeatmap, heatLevel, niceCeil, percent } from "../lib/logic";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const shortDate = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS_SHORT[m - 1]}`;
};

/** Stacked daily bars: portions sold (green) + wasted (red); tap/hover a day for details. */
export function DailyPortionsChart({ daily }: { daily: AnalyticsResponse["daily"] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceCeil(Math.max(1, ...daily.map((d) => d.portions_sold + d.portions_wasted)));
  const ticks = [max, max / 2, 0];
  const shown = active !== null ? daily[active] : null;
  const totals = daily.reduce((a, d) => ({ sold: a.sold + d.portions_sold, wasted: a.wasted + d.portions_wasted, rev: a.rev + d.revenue_idr }), { sold: 0, wasted: 0, rev: 0 });
  const labelEvery = daily.length > 45 ? 15 : daily.length > 14 ? 7 : 1;

  return (
    <figure>
      <div className="mb-3 flex min-h-12 flex-wrap items-end justify-between gap-2" aria-live="polite">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">{shown ? shortDate(shown.date) : `${daily.length} hari terakhir`}</p>
          <p className="text-lg font-extrabold tabular-nums">{formatIdr(shown ? shown.revenue_idr : totals.rev)}</p>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary" aria-hidden /> Terjual <b className="tabular-nums">{shown ? shown.portions_sold : totals.sold}</b>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-urgent/70" aria-hidden /> Terbuang <b className="tabular-nums">{shown ? shown.portions_wasted : totals.wasted}</b>
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex h-40 flex-col justify-between text-right text-[10px] text-muted-foreground tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {t}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40" onMouseLeave={() => setActive(null)}>
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
              {ticks.map((t) => (
                <span key={t} className="border-t border-dashed border-border" />
              ))}
            </div>
            <ol className={cn("relative flex h-full items-end", daily.length > 45 ? "gap-px" : "gap-[3px]")} aria-label="Porsi per hari">
              {daily.map((d, i) => {
                const soldH = (d.portions_sold / max) * 100;
                const wastedH = (d.portions_wasted / max) * 100;
                return (
                  <li key={d.date} className="flex h-full min-w-0 flex-1">
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      onClick={() => setActive(i === active ? null : i)}
                      aria-label={`${shortDate(d.date)}: ${d.portions_sold} terjual, ${d.portions_wasted} terbuang, ${formatIdr(d.revenue_idr)}`}
                      className={cn(
                        "flex h-full w-full flex-col justify-end rounded-t-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active === i ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="w-full rounded-t-[3px] bg-urgent/70" style={{ height: `${wastedH}%` }} />
                      <span className={cn("w-full bg-primary", wastedH === 0 && "rounded-t-[3px]")} style={{ height: `${soldH}%` }} />
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="mt-1.5 flex text-[10px] text-muted-foreground tabular-nums" aria-hidden>
            {daily.map((d, i) => (
              <span key={d.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                {i % labelEvery === 0 ? shortDate(d.date) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

export function TopMenusBars({ menus }: { menus: AnalyticsResponse["top_menus"] }) {
  const max = Math.max(1, ...menus.map((m) => m.portions_sold));
  return (
    <ol className="space-y-3">
      {menus.map((m, i) => (
        <li key={m.menu_id}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold">
              <span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>
              {m.menu_name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              <b className="text-foreground">{m.portions_sold}</b> porsi · {formatIdr(m.revenue_idr)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(m.portions_sold / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

const HEAT_MIX = [0, 16, 34, 56, 82];

function heatStyle(level: number) {
  if (level === 0) return { background: "var(--muted)" };
  return { background: `color-mix(in oklch, var(--deal) ${HEAT_MIX[level]}%, var(--card))` };
}

/** Blueprint WeeklySurplusHeatmap: weekday × menu, average surplus portions (last 4 weeks). */
export function WeeklySurplusHeatmap({ cells }: { cells: InsightsResponse["heatmap"] }) {
  const { rows, max, min, peak } = buildHeatmap(cells);
  if (!rows.length) return <p className="text-sm text-muted-foreground">Belum cukup data riwayat untuk peta panas.</p>;
  return (
    <div>
      {peak && (
        <p className="mb-3 text-sm">
          Paling sering berlebih: <b>{peak.menu}</b> tiap <b>{DAY_NAMES_ID[peak.day]}</b> (~{peak.value.toLocaleString("id-ID", { maximumFractionDigits: 1 })} porsi).
        </p>
      )}
      <div className="-mx-1">
        <table className="w-full table-fixed border-separate border-spacing-[3px] text-xs sm:border-spacing-1">
          <caption className="sr-only">Rata-rata porsi surplus per hari dan menu, 4 minggu terakhir</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[5.5rem] text-left font-semibold text-muted-foreground sm:w-40">
                Menu
              </th>
              {WEEK_ORDER.map((d) => (
                <th key={d} scope="col" className="text-[11px] font-semibold text-muted-foreground">
                  {DAY_NAMES_ID[d].slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.menu_id}>
                <th scope="row" className="pr-1 text-left text-[11px] leading-tight font-semibold sm:text-[13px]" title={r.menu_name}>
                  <span className="line-clamp-2">{r.menu_name}</span>
                </th>
                {WEEK_ORDER.map((d) => {
                  const v = r.values[d];
                  const lvl = v === null ? 0 : heatLevel(v, max, min);
                  const left = r.leftovers[d];
                  return (
                    <td
                      key={d}
                      className={cn("h-10 rounded-md text-center text-[11px] font-bold tabular-nums sm:h-11 sm:rounded-lg sm:text-xs", lvl >= 3 ? "text-white" : "text-foreground/80")}
                      style={heatStyle(lvl)}
                      title={v === null ? "Tidak ada data" : `${DAY_NAMES_ID[d]}: rata-rata ${v} porsi surplus, ${left ?? 0} terbuang`}
                    >
                      {v === null ? <span className="text-muted-foreground">–</span> : v.toLocaleString("id-ID", { maximumFractionDigits: 1 })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground" aria-hidden>
        <span>Sedikit</span>
        {Array.from({ length: HEATMAP_LEVELS }, (_, l) => (
          <span key={l} className="h-3 w-6 rounded" style={heatStyle(l)} />
        ))}
        <span>Banyak surplus</span>
      </div>
    </div>
  );
}

/** 7-day prediction outlook from the Surplus Prediction Engine. */
export function PredictionOutlook({ week }: { week: InsightsResponse["week"] }) {
  const max = niceCeil(Math.max(1, ...week.map((w) => w.predicted_surplus_portions)));
  return (
    <ol className="grid grid-cols-7 gap-1.5" aria-label="Prediksi 7 hari">
      {week.map((w, i) => {
        const h = (w.predicted_surplus_portions / max) * 100;
        return (
          <li key={w.date} className="flex flex-col items-center gap-1 text-center" aria-label={`${DAY_NAMES_ID[w.day_of_week]}: ~${Math.round(w.predicted_surplus_portions)} porsi, peluang habis ${percent(w.sellout_probability_at_50pct)}`}>
            <span className="text-[11px] font-extrabold tabular-nums">~{Math.round(w.predicted_surplus_portions)}</span>
            <span className="flex h-20 w-full items-end rounded-xl bg-muted p-1" aria-hidden>
              <span className={cn("w-full rounded-lg", i === 0 ? "bg-deal" : "bg-chart-2/60")} style={{ height: `${Math.max(6, h)}%` }} />
            </span>
            <span className={cn("text-[11px] font-semibold", i === 0 ? "text-deal" : "text-muted-foreground")}>{i === 0 ? "Hari ini" : DAY_NAMES_ID[w.day_of_week].slice(0, 3)}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">{percent(w.confidence_score)}</span>
          </li>
        );
      })}
    </ol>
  );
}
