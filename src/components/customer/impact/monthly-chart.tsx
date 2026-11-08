"use client";

/** MonthlyImpactChart — accessible SVG bar chart (no chart library). */
import { BarChart3Icon } from "lucide-react";
import type { MonthlyImpact } from "@/lib/contracts";
import { formatKg } from "@/lib/impact";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { monthLabel } from "../lib/format";

type Metric = "food" | "co2" | "money";

const METRICS: { key: Metric; label: string; color: string; pick: (m: MonthlyImpact) => number; fmt: (n: number) => string }[] = [
  { key: "food", label: "Pangan", color: "var(--primary)", pick: (m) => m.food_saved_grams, fmt: formatKg },
  { key: "co2", label: "CO₂e", color: "var(--chart-3)", pick: (m) => m.co2_avoided_grams, fmt: formatKg },
  {
    key: "money",
    label: "Hemat",
    color: "var(--deal)",
    pick: (m) => m.money_saved_idr,
    fmt: (n) => (n >= 1000 ? `${(n / 1000).toLocaleString("id-ID", { maximumFractionDigits: 0 })}rb` : formatIdr(n)),
  },
];

/** Last `n` months present in the data, oldest first. */
export function lastMonths(monthly: MonthlyImpact[], n = 6): MonthlyImpact[] {
  return [...monthly].sort((a, b) => a.month.localeCompare(b.month)).slice(-n);
}

export function MonthlyImpactChart({
  monthly,
  metric,
  onMetricChange,
}: {
  monthly: MonthlyImpact[];
  metric: Metric;
  onMetricChange: (m: Metric) => void;
}) {
  const def = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const data = lastMonths(monthly);
  const values = data.map(def.pick);
  const max = Math.max(1, ...values);
  const W = 320;
  const H = 150;
  const top = 22;
  const bottom = 22;
  const slot = data.length ? W / data.length : W;
  const barW = Math.min(36, slot * 0.55);
  const summary = data.length
    ? `Grafik ${def.label} per bulan: ${data.map((m, i) => `${monthLabel(m.month)} ${def.fmt(values[i])}`).join(", ")}`
    : "Belum ada data bulanan";

  return (
    <section className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border" aria-labelledby="chart-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="chart-title" className="flex items-center gap-1.5 text-sm font-extrabold whitespace-nowrap">
          <BarChart3Icon className="size-4 text-primary" /> Per bulan
        </h2>
        <div role="radiogroup" aria-label="Pilih metrik" className="inline-flex rounded-full bg-muted p-0.5">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={metric === m.key}
              onClick={() => onMetricChange(m.key)}
              className={cn(
                "h-8 rounded-full px-3 text-xs font-bold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                metric === m.key ? "bg-card text-foreground shadow-soft" : "text-muted-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Grafik muncul setelah pesanan pertamamu selesai diambil.
        </p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label={summary}>
            <line x1={0} x2={W} y1={H - bottom} y2={H - bottom} stroke="var(--border)" strokeWidth={1} />
            {data.map((m, i) => {
              const v = values[i];
              const h = Math.max(v > 0 ? 3 : 0, ((H - top - bottom) * v) / max);
              const x = i * slot + (slot - barW) / 2;
              const y = H - bottom - h;
              const last = i === data.length - 1;
              return (
                <g key={m.month}>
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    rx={7}
                    fill={def.color}
                    opacity={last ? 1 : 0.55}
                    className="transition-all duration-500"
                  />
                  <text
                    x={x + barW / 2}
                    y={y - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill="var(--foreground)"
                  >
                    {v > 0 ? def.fmt(v) : "–"}
                  </text>
                  <text
                    x={x + barW / 2}
                    y={H - 6}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={last ? 800 : 600}
                    fill={last ? "var(--foreground)" : "var(--muted-foreground)"}
                  >
                    {monthLabel(m.month)}
                  </text>
                </g>
              );
            })}
          </svg>
          <table className="sr-only">
            <caption>Dampak per bulan</caption>
            <thead>
              <tr>
                <th>Bulan</th>
                <th>Pesanan</th>
                <th>Pangan</th>
                <th>CO₂e</th>
                <th>Hemat</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{m.orders}</td>
                  <td>{formatKg(m.food_saved_grams)}</td>
                  <td>{formatKg(m.co2_avoided_grams)}</td>
                  <td>{formatIdr(m.money_saved_idr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
