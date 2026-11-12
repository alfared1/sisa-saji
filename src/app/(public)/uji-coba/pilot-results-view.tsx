"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { ErrorState } from "@/components/common/error-state";
import { Logo } from "@/components/common/logo";
import { ThemeToggle } from "@/components/common/theme-switcher";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { LEFTOVER_DESTINATIONS, type PilotStats } from "@/lib/contracts";
import { CO2E_SOURCE } from "@/lib/impact";
import { formatIdr } from "@/lib/time";

export const PILOT_STATS_QUERY_KEY = ["stats", "pilot"] as const;

const kg = (grams: number) =>
  (grams / 1000).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

function Figure({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <p className="text-2xl leading-tight font-extrabold tabular-nums sm:text-3xl">
        {value}
        {unit && <span className="ml-1 text-base font-bold text-muted-foreground">{unit}</span>}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

const LEFTOVER_NAMES = {
  donated: "dibagikan",
  animal_feed: "jadi pakan ternak atau maggot",
  compost: "dikompos",
  discarded: "dibuang",
} as const;

/** "turun 62%" / "naik 10%" / "tetap": the change in portions thrown away versus before the pilot. */
export function wasteChangeText(pct: number): string {
  if (pct > 0) return `turun ${pct}%`;
  if (pct < 0) return `naik ${-pct}%`;
  return "tetap";
}

function LeftoverSection({ l }: { l: PilotStats["leftovers"] }) {
  return (
    <section aria-labelledby="sampah-title" className="mt-8">
      <h2 id="sampah-title" className="text-lg font-bold">
        Sampah warung
      </h2>
      {l.nights_reported === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Belum ada laporan sisa. Setiap malam setelah tutup, warung mencatat porsi yang tetap tidak laku: dibagikan, jadi pakan,
          dikompos, atau dibuang.
        </p>
      ) : (
        <div className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-border">
          {l.waste_reduction_pct !== null ? (
            <p className="text-2xl leading-tight font-extrabold sm:text-3xl">
              Porsi yang dibuang {wasteChangeText(l.waste_reduction_pct)}
            </p>
          ) : (
            <p className="text-base font-bold">Perbandingan dengan sebelum uji coba belum tersedia.</p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Dibanding sebelum ikut uji coba, dari {l.nights_reported} malam laporan.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            {LEFTOVER_DESTINATIONS.map((k) => (
              <li key={k}>
                <b className="block text-lg font-extrabold tabular-nums">{l[k].toLocaleString("id-ID")}</b>
                <span className="text-muted-foreground">porsi {LEFTOVER_NAMES[k]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** /uji-coba: the field pilot's real numbers, kept apart from the demo data on purpose. */
export function PilotResultsView() {
  const stats = useQuery({
    queryKey: PILOT_STATS_QUERY_KEY,
    queryFn: () => api.get<PilotStats>("/stats/pilot"),
    refetchInterval: 60_000,
  });
  const s = stats.data;

  return (
    <div className="app-backdrop min-h-dvh">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16">
        <header className="safe-top flex h-16 items-center justify-between">
          <Link
            href="/welcome"
            aria-label="Beranda Sisa-Saji"
            className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo />
          </Link>
          <ThemeToggle />
        </header>

        <Link
          href="/welcome"
          className="inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden /> Beranda
        </Link>

        <h1 className="mt-2 text-3xl leading-tight font-extrabold sm:text-4xl">Hasil uji coba di warung sungguhan</h1>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-muted-foreground">
          Angka di halaman ini hanya berasal dari warung yang ikut uji coba lapangan. Data contoh di aplikasi demo tidak
          ikut dihitung.
        </p>

        {stats.isPending ? (
          <div className="mt-8 grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : stats.isError || !s ? (
          <div className="mt-8">
            <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
          </div>
        ) : s.warung_count === 0 ? (
          <section className="mt-8 rounded-3xl bg-card p-6 ring-1 ring-border">
            <h2 className="text-lg font-bold">Uji coba belum dimulai</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Belum ada warung yang bergabung. Angka akan muncul di sini setelah warung pertama ikut dan pesanan pertama
              diambil.
            </p>
          </section>
        ) : (
          <>
            <p className="mt-6 text-sm font-semibold text-muted-foreground">
              {s.warung_count} warung ikut uji coba{s.started_at ? ` sejak ${dateLabel(s.started_at)}` : ""}
            </p>
            <section aria-label="Hasil uji coba" className="mt-3 grid grid-cols-2 gap-3">
              <Figure value={s.portions_rescued.toLocaleString("id-ID")} label="porsi terselamatkan" />
              <Figure value={kg(s.food_saved_grams)} unit="kg" label="pangan tidak terbuang" />
              <Figure value={kg(s.co2_avoided_grams)} unit="kg" label="emisi CO₂e dicegah" />
              <Figure value={formatIdr(s.warung_revenue_idr)} label="pemasukan warung dari surplus" />
              <Figure value={s.orders_completed.toLocaleString("id-ID")} label="pesanan diambil" />
              <Figure value={s.unique_buyers.toLocaleString("id-ID")} label="pembeli berbeda" />
            </section>

            <LeftoverSection l={s.leftovers} />

            <section aria-labelledby="warung-title" className="mt-8">
              <h2 id="warung-title" className="text-lg font-bold">
                Per warung
              </h2>
              <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                {s.warung.map((w) => (
                  <li key={w.slug} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <Link href={`/warung/${w.slug}`} className="block truncate font-semibold hover:underline">
                        {w.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">Bergabung {dateLabel(w.joined_at)}</p>
                      {w.waste_reduction_pct !== null && (
                        <p className="text-xs text-muted-foreground">
                          Porsi dibuang {wasteChangeText(w.waste_reduction_pct)} ({w.nights_reported} malam laporan)
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 text-right text-sm">
                      <b className="font-extrabold tabular-nums">{w.portions_rescued.toLocaleString("id-ID")}</b> porsi
                      <span className="block text-xs text-muted-foreground tabular-nums">{kg(w.food_saved_grams)} kg</span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            {s.daily.length > 0 && (
              <section aria-labelledby="harian-title" className="mt-8">
                <h2 id="harian-title" className="text-lg font-bold">
                  Per hari
                </h2>
                <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                  {s.daily.map((d) => (
                    <li key={d.date} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span>{dateLabel(`${d.date}T12:00:00+07:00`)}</span>
                      <span className="tabular-nums">
                        <b className="font-extrabold">{d.portions_rescued}</b> porsi · {kg(d.food_saved_grams)} kg
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <section aria-labelledby="cara-hitung" className="mt-10 rounded-2xl bg-muted p-4 text-sm leading-relaxed text-foreground/85">
          <h2 id="cara-hitung" className="font-bold text-foreground">
            Cara menghitung
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Hanya pesanan di warung uji coba yang dibuat setelah warung bergabung.</li>
            <li>
              Hanya pesanan yang benar-benar diambil dan diverifikasi warung lewat QR atau kode. Pesanan batal atau tidak
              diambil tidak dihitung.
            </li>
            <li>Pesanan pemilik warung di warungnya sendiri tidak dihitung.</li>
            <li>
              Berat pangan dari berat porsi tiap menu. Emisi memakai faktor 2,5 kg CO₂e per kg pangan, dari{" "}
              <a href={CO2E_SOURCE.url} className="font-semibold text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
                {CO2E_SOURCE.label}
              </a>
              .
            </li>
            <li>
              Saat bergabung, pemilik warung memperkirakan berapa porsi biasanya tersisa per malam. Angka ini tidak bisa diubah
              setelah disimpan.
            </li>
            <li>
              Porsi dibuang turun = 1 − (porsi dibuang ÷ (perkiraan sebelum uji coba × jumlah malam laporan)), hanya dari warung
              yang mengisi perkiraan. Porsi yang dibagikan, jadi pakan, atau dikompos tidak dihitung sebagai dibuang.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
