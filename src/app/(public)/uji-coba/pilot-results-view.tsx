"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/common/error-state";
import { PublicFooter, PublicHeader } from "@/components/common/public-chrome";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api/client";
import {
  PAY_AT_WARUNG_HOLD_MINUTES,
  PAY_AT_WARUNG_MAX_PORTIONS,
  PAY_AT_WARUNG_NO_SHOW_LIMIT,
  PAY_AT_WARUNG_NO_SHOW_WINDOW_DAYS,
} from "@/lib/constants";
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
        {unit && <span className="ml-1 text-base font-semibold text-muted-foreground">{unit}</span>}
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
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Dilaporkan sendiri oleh warung, tidak diperiksa tim Sisa-Saji.
      </p>
      {l.nights_reported === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Belum ada laporan sisa. Setiap malam setelah tutup, warung mencatat porsi yang tetap tidak laku: dibagikan, jadi pakan,
          dikompos, atau dibuang.
        </p>
      ) : (
        <div className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-border">
          {l.waste_reduction_pct !== null ? (
            <p className="text-2xl leading-tight font-bold sm:text-3xl">
              Porsi yang dibuang {wasteChangeText(l.waste_reduction_pct)}
            </p>
          ) : (
            <p className="text-base font-semibold">Perbandingan dengan sebelum uji coba belum tersedia.</p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Dibanding porsi yang biasanya dibuang per malam sebelum ikut uji coba, menurut laporan warung dari{" "}
            {l.nights_reported} malam.
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

const PILOT_RULES = [
  "Bayar langsung di warung, tunai atau QRIS milik warung.",
  "Tanpa biaya layanan dan tanpa voucher.",
  `Porsi ditahan ${PAY_AT_WARUNG_HOLD_MINUTES} menit, paling banyak ${PAY_AT_WARUNG_MAX_PORTIONS} porsi per tiket.`,
  `${PAY_AT_WARUNG_NO_SHOW_LIMIT} tiket tidak diambil dalam ${PAY_AT_WARUNG_NO_SHOW_WINDOW_DAYS} hari: belum bisa memesan di warung uji coba dulu.`,
  "Foto menu dan etalase tampil ke semua pembeli, dengan jam unggah.",
] as const;

function RulesCard() {
  return (
    <section aria-labelledby="aturan-title" className="ss-anyaman rounded-3xl bg-deep p-6 text-on-deep">
      <h2 id="aturan-title" className="font-bold text-leaf">
        Aturan di warung uji coba
      </h2>
      <ul className="mt-3 space-y-2.5 leading-relaxed">
        {PILOT_RULES.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </section>
  );
}

const MODE_ROWS: readonly [string, string, string][] = [
  ["Warung", "Warung fiktif dari data contoh", "Warung sungguhan yang bergabung dengan kode undangan"],
  ["Bayar", "QRIS, GoPay, DANA disimulasikan; tunai di warung", "Hanya bayar langsung di warung (tunai atau QRIS milik warung)"],
  ["Biaya layanan dan voucher", "Ada untuk bayar online", "Tidak ada"],
  ["Saldo warung", "Bertambah dari pesanan online, pencairan disimulasikan", "Tidak dipakai, uang sudah diterima di tempat"],
  ["Foto etalase dan foto menu", "Hanya pemilik (foto akun demo: sesi demo, 60 menit)", "Tampil ke semua pembeli, dengan jam unggah"],
  ["Login", "Kode OTP boleh tampil di layar", "Wajib kode yang benar-benar terkirim"],
  ["Akun demo pembeli", "Bisa memesan", "Tidak bisa memesan"],
  ["Notifikasi Jam Lapar", "Tidak memicu notifikasi", "Memicu notifikasi ke pembeli dalam 500 m"],
  ["Hasil di halaman ini", "Tidak dihitung", "Hanya pesanan selesai setelah bergabung, tanpa pesanan pemilik sendiri"],
  ["Menu otomatis", "Diisi ulang supaya selalu ada menu", "Tidak pernah diisi otomatis"],
  ["Reset data", "Dihapus dan dibuat ulang", "Ditolak tanpa izin khusus"],
];

function ModesTable() {
  return (
    <section aria-labelledby="mode-title" className="mt-12">
      <h2 id="mode-title" className="text-xl font-bold">
        Data demo dan warung uji coba
      </h2>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Dua mode berjalan berdampingan. Tabel ini menunjukkan apa yang berbeda, supaya angka demo tidak tertukar dengan angka
        lapangan.
      </p>
      <div className="mt-4 overflow-x-auto rounded-2xl bg-card ring-1 ring-border">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-surface">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Hal
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Data demo
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Warung uji coba
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {MODE_ROWS.map(([what, demo, pilot]) => (
              <tr key={what}>
                <th scope="row" className="px-4 py-3 align-top font-semibold">
                  {what}
                </th>
                <td className="px-4 py-3 align-top text-muted-foreground">{demo}</td>
                <td className="px-4 py-3 align-top">{pilot}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Joining happens in the warung's own settings (it needs the owner's session and real OTP). */
function JoinSection() {
  const { user } = useSession();
  const owner = Boolean(user?.merchant_id);
  return (
    <section aria-labelledby="gabung-title" className="mt-12 grid gap-4 rounded-3xl bg-card p-6 ring-1 ring-border sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <h2 id="gabung-title" className="text-xl font-bold">
          Bergabung
        </h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Untuk pemilik warung yang sudah menerima kode undangan dari tim. Kode dimasukkan di Pengaturan mode warung, dan butuh
          kode masuk yang benar-benar terkirim ke WhatsApp atau email.
        </p>
      </div>
      <Link
        href={owner ? "/merchant/settings#uji-coba" : "/auth/login?role=MERCHANT&next=%2Fmerchant%2Fsettings"}
        className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {owner ? "Masukkan kode undangan" : "Masuk sebagai pemilik warung"}
      </Link>
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
      <PublicHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-4 lg:px-8">
        <div className="grid gap-6 pt-6 lg:grid-cols-[1.4fr_1fr] lg:items-start lg:gap-10 lg:pt-12">
          <div>
            <h1 className="text-4xl leading-tight font-bold sm:text-5xl">Uji coba lapangan</h1>
            <p className="mt-4 max-w-prose text-lg leading-relaxed">
              Warung sungguhan bergabung dengan kode undangan. Di sini hanya tampil hasil dari warung itu, terpisah dari data demo
              yang ada di aplikasi.
            </p>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
              Pesanan dihitung dari pengambilan yang diverifikasi di aplikasi, tanpa pesanan pemilik di warungnya sendiri. Angka
              sampah dilaporkan sendiri oleh warung.
            </p>
          </div>
          <RulesCard />
        </div>

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
            <section aria-label="Hasil uji coba" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Figure value={s.portions_rescued.toLocaleString("id-ID")} label="porsi terselamatkan" />
              <Figure value={kg(s.food_saved_grams)} unit="kg" label="pangan tidak terbuang" />
              <Figure value={kg(s.co2_avoided_grams)} unit="kg" label="emisi CO₂e dicegah" />
              <Figure value={formatIdr(s.warung_revenue_idr)} label="pemasukan warung dari surplus" />
              <Figure value={s.orders_completed.toLocaleString("id-ID")} label="pesanan diambil" />
              <Figure value={s.unique_buyers.toLocaleString("id-ID")} label="pembeli berbeda" />
              <Figure value={s.tickets_unclaimed.toLocaleString("id-ID")} label="tiket bayar di warung tidak diambil" />
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
                          Porsi dibuang {wasteChangeText(w.waste_reduction_pct)}, menurut laporan warung ({w.nights_reported}{" "}
                          malam)
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
                        <b className="font-semibold">{d.portions_rescued}</b> porsi · {kg(d.food_saved_grams)} kg
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <ModesTable />
        <JoinSection />

        <section aria-labelledby="cara-hitung" className="mt-10 rounded-2xl bg-muted p-4 text-sm leading-relaxed text-foreground/85">
          <h2 id="cara-hitung" className="font-semibold text-foreground">
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
              Saat bergabung, pemilik warung memperkirakan berapa porsi biasanya dibuang per malam sebelum memakai Sisa-Saji.
              Angka ini tidak bisa diubah setelah disimpan.
            </li>
            <li>
              Setiap malam, warung melaporkan sendiri ke mana porsi yang tidak laku pergi. Tim Sisa-Saji tidak memeriksa angka
              ini di lapangan.
            </li>
            <li>
              Porsi dibuang turun = 1 − (porsi dibuang ÷ (perkiraan dibuang sebelum uji coba × jumlah malam laporan)), hanya dari
              warung yang mengisi perkiraan. Kedua sisi hanya menghitung porsi yang dibuang. Porsi yang dibagikan, jadi pakan,
              atau dikompos tidak dihitung sebagai dibuang.
            </li>
          </ul>
        </section>
      </div>
      <PublicFooter />
    </div>
  );
}
