"use client";

import Link from "next/link";
import { BanknoteIcon, CirclePlayIcon } from "lucide-react";
import { PublicFooter, PublicHeader } from "@/components/common/public-chrome";
import { TudungIcon } from "@/components/common/tudung-icon";
import { FoodThumb } from "@/components/customer/food-thumb";
import { InstallBanner } from "@/components/pwa/install-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalStats } from "@/hooks/use-global-stats";
import {
  MERCHANT_PREMIUM_PRICE_IDR,
  PAY_AT_WARUNG_HOLD_MINUTES,
  PAY_AT_WARUNG_MAX_PORTIONS,
  PAYMENT_TTL_SECONDS,
  PLATFORM_COMMISSION_DEFAULT_IDR,
} from "@/lib/constants";
import { EVENING_CARD_QUOTE, EVENING_EXAMPLE } from "@/lib/pricing/evening-example";
import { formatIdr } from "@/lib/time";
import { PriceSliderCard } from "./price-slider-card";

const LOCK_MINUTES = Math.round(PAYMENT_TTL_SECONDS / 60);

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function StatTile({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-surface p-3">
      <p className="truncate text-xl leading-tight font-extrabold tabular-nums sm:text-2xl">
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-muted-foreground">{unit}</span>}
      </p>
      <p className="text-xs leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

export function ImpactStats() {
  const stats = useGlobalStats({ refetchInterval: 30_000 });
  const s = stats.data;

  return (
    <section aria-labelledby="dampak-title" className="rounded-3xl bg-card p-4 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dampak-title" className="text-sm font-semibold">
          Dampak bersama
        </h2>
        {s?.is_demo_data && (
          <span className="rounded-full bg-warning-soft px-2 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200">Data demo</span>
        )}
      </div>
      {stats.isPending ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[5.25rem] rounded-2xl" />
          ))}
        </div>
      ) : stats.isError || !s ? (
        <p className="mt-3 rounded-2xl bg-surface p-3 text-sm text-muted-foreground">
          Statistik belum bisa dimuat. Patokannya tetap: satu porsi yang diselamatkan mencegah sekitar 0,5 kg emisi CO₂e.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatTile value={fmt(s.total_food_saved_grams / 1000, 1)} unit="kg" label="pangan diselamatkan" />
            <StatTile value={fmt(s.total_co2_avoided_grams / 1000, 1)} unit="kg" label="emisi CO₂e dicegah" />
            <StatTile value={fmt(s.total_orders_completed)} label="pesanan diambil" />
            <StatTile value={fmt(s.active_merchants)} label="warung buka" />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {s.is_demo_data
              ? "Angka ini dihitung dari warung dan pesanan contoh, belum dari transaksi sungguhan."
              : `${fmt(s.live_batches)} menu surplus masih tersedia malam ini.`}
          </p>
        </>
      )}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Mendukung SDG 12.3: mengurangi separuh sampah pangan per kapita di tingkat ritel dan konsumen pada 2030.
      </p>
    </section>
  );
}

/* ----------------------------- "Dari Beranda sampai pintu warung" ----------------------------- */

/** Small, static pictures of the real screens; hidden from screen readers (the captions say it). */
function MenuCardPreview() {
  const q = EVENING_CARD_QUOTE;
  return (
    <div aria-hidden className="overflow-hidden rounded-3xl bg-card ring-1 ring-border">
      <div className="relative">
        <FoodThumb category="MAKANAN_BERAT" alt="" noPhotoLabel className="h-36 w-full rounded-none" />
        <span className="absolute top-3 left-3 rounded-full bg-hemat px-2 py-1 text-xs font-extrabold text-white">
          Hemat {q.recommendedDiscountPct}%
        </span>
      </div>
      <div className="p-4">
        <p className="font-bold">{EVENING_EXAMPLE.name}</p>
        <p className="text-sm text-muted-foreground">Warung contoh · 350 m, bisa jalan kaki</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-deal tabular-nums">{formatIdr(q.recommendedSellingPriceIdr)}</span>
          <span className="text-sm text-muted-foreground tabular-nums line-through">{formatIdr(EVENING_EXAMPLE.priceIdr)}</span>
        </p>
        <span className="mt-1 block h-1 w-9 rounded-full bg-plate" />
        <p className="mt-2 text-sm font-semibold">Sisa 3 porsi</p>
      </div>
    </div>
  );
}

function LockPreview() {
  const price = EVENING_CARD_QUOTE.recommendedSellingPriceIdr;
  return (
    <div aria-hidden className="rounded-3xl bg-card p-4 ring-1 ring-border">
      <p className="flex items-center gap-2 font-semibold">
        <TudungIcon className="size-6 text-primary" /> Porsi dikunci untukmu
      </p>
      <p className="mt-2 text-3xl font-extrabold text-deal tabular-nums">Bayar dalam 09:41</p>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt>1 × {EVENING_EXAMPLE.name}</dt>
          <dd className="tabular-nums">{formatIdr(price)}</dd>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <dt>Biaya layanan</dt>
          <dd className="tabular-nums">{formatIdr(PLATFORM_COMMISSION_DEFAULT_IDR)}</dd>
        </div>
        <div className="flex justify-between gap-2 border-t border-border pt-1.5 font-bold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatIdr(price + PLATFORM_COMMISSION_DEFAULT_IDR)}</dd>
        </div>
      </dl>
      <span className="mt-3 flex h-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
        Bayar {formatIdr(price + PLATFORM_COMMISSION_DEFAULT_IDR)}
      </span>
    </div>
  );
}

function TicketPreview() {
  return (
    <div aria-hidden className="ss-anyaman flex h-full min-h-56 flex-col rounded-3xl bg-deep p-5 text-on-deep">
      <p className="text-sm text-leaf">Tiket asli</p>
      <p className="mt-1 text-4xl font-extrabold tracking-[0.08em] tabular-nums">SJ-4821</p>
      <p className="mt-3 text-2xl font-extrabold tabular-nums">Ambil dalam 01:22:00</p>
      <p className="mt-2 text-sm leading-relaxed text-leaf">1 porsi {EVENING_EXAMPLE.name} di warung contoh. Lunas lewat QRIS.</p>
    </div>
  );
}

const STEPS = [
  {
    title: "Pilih menu di Beranda",
    body: "Lihat harga kini, sisa porsi, dan jarak jalan kaki dari kampus.",
    preview: <MenuCardPreview />,
  },
  {
    title: `Kunci porsi, bayar QRIS dalam ${LOCK_MINUTES} menit`,
    body: `Porsimu ditahan selama kamu bayar. Lewat dari ${LOCK_MINUTES} menit, porsi kembali ke warung.`,
    preview: <LockPreview />,
  },
  {
    title: "Tunjukkan tiket di warung",
    body: "Tunjukkan QR atau kode tiket sebelum warung tutup. Tiket tersimpan di HP, bisa dibuka tanpa sinyal.",
    preview: <TicketPreview />,
  },
] as const;

function HowItWorks() {
  return (
    <section id="cara-kerja" aria-labelledby="cara-kerja-title" className="scroll-mt-4 border-y border-border bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 lg:px-8">
        <h2 id="cara-kerja-title" className="text-2xl font-bold sm:text-3xl">
          Dari Beranda sampai pintu warung
        </h2>
        <p className="mt-2 text-muted-foreground">Tiga langkah, semuanya kamu lakukan sendiri. Contoh tampilannya di HP:</p>
        <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-6">
          {STEPS.map((s) => (
            <li key={s.title} className="flex flex-col gap-4">
              {s.preview}
              <div>
                <h3 className="text-lg font-bold text-balance">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-8 flex max-w-3xl items-start gap-3 text-sm leading-relaxed">
          <BanknoteIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <strong>Lebih suka tunai?</strong> Pilih bayar tunai di warung: tiket langsung jadi, porsi ditahan{" "}
            {PAY_AT_WARUNG_HOLD_MINUTES} menit, paling banyak {PAY_AT_WARUNG_MAX_PORTIONS} porsi, tanpa biaya layanan.
          </span>
        </p>
      </div>
    </section>
  );
}

/* ----------------------------------- "Untuk warung" ----------------------------------- */

const MERCHANT_POINTS = [
  ["Publikasi kurang dari satu menit.", "Pilih menu, isi jumlah porsi, tekan Publikasikan Sekarang."],
  ["Harga otomatis, ada harga minimum.", "Harga turun mengikuti jam tutup dan tidak pernah di bawah batas yang kamu tentukan."],
  ["Saldo bertambah saat pesanan diambil.", "Warung menerima penuh subtotal pesanan online."],
  ["Laporan sisa.", "Setelah tutup, catat ke mana porsi yang tidak terjual pergi."],
] as const;

function PublishPreview() {
  const field = "flex h-11 items-center rounded-xl border border-input bg-card px-3 text-sm";
  return (
    <div aria-hidden className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-bold">Publikasi surplus</p>
        <span className="rounded-full bg-warning-soft px-2 py-1 text-[11px] font-semibold text-amber-900 dark:text-amber-100">Contoh tampilan</span>
      </div>
      <p className="mt-4 text-sm font-semibold">Menu</p>
      <p className={`mt-1 ${field}`}>{EVENING_EXAMPLE.name}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm font-semibold">Jumlah porsi</p>
          <p className={`mt-1 ${field} tabular-nums`}>6</p>
        </div>
        <div>
          <p className="text-sm font-semibold">Harga normal</p>
          <p className={`mt-1 ${field} tabular-nums`}>{formatIdr(EVENING_EXAMPLE.priceIdr)}</p>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold">Harga minimum</p>
      <p className={`mt-1 ${field} tabular-nums`}>{formatIdr(EVENING_EXAMPLE.floorIdr)}</p>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface p-3">
        <span>
          <span className="block text-sm font-semibold">Harga otomatis</span>
          <span className="block text-xs text-muted-foreground">
            Harga turun sendiri sampai harga minimum {formatIdr(EVENING_EXAMPLE.floorIdr)}.
          </span>
        </span>
        <span className="relative h-7 w-12 shrink-0 rounded-full bg-primary">
          <span className="absolute top-1 right-1 size-5 rounded-full bg-white" />
        </span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Sekitar 8 porsi kemungkinan belum laku malam ini.</p>
      <span className="mt-4 flex h-12 items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground">
        Publikasikan Sekarang
      </span>
    </div>
  );
}

function ForWarung() {
  return (
    <section id="untuk-warung" aria-labelledby="untuk-warung-title" className="mx-auto w-full max-w-6xl scroll-mt-4 px-4 py-14 lg:px-8">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <div>
          <h2 id="untuk-warung-title" className="text-2xl font-bold text-balance sm:text-3xl">
            Untuk warung: porsi sisa jadi pemasukan
          </h2>
          <p className="mt-2 text-muted-foreground">Pemilik warung menyiapkan sisa jualan, Sisa-Saji mengatur harganya sampai warung tutup.</p>
          <ul className="mt-6 divide-y divide-border border-y border-border">
            {MERCHANT_POINTS.map(([lead, rest]) => (
              <li key={lead} className="py-3.5 leading-relaxed">
                <strong>{lead}</strong> {rest}
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-2xl bg-surface p-4 text-sm leading-relaxed">
            <p>
              <strong>Biaya layanan {formatIdr(PLATFORM_COMMISSION_DEFAULT_IDR)}</strong> per transaksi yang berhasil, dibayar pembeli.
            </p>
            <p className="mt-1">
              <strong>Mitra Terverifikasi {formatIdr(MERCHANT_PREMIUM_PRICE_IDR)} per bulan</strong>, opsional.
            </p>
          </div>
          <Link
            href="/auth/login?role=MERCHANT"
            className="mt-6 inline-flex h-12 items-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Daftarkan warung
          </Link>
        </div>
        <PublishPreview />
      </div>
    </section>
  );
}

/* ----------------------------------- Demo vs field ----------------------------------- */

function DemoOrField() {
  const stats = useGlobalStats();
  const demo = stats.data?.is_demo_data ?? false;
  return (
    <section aria-labelledby="data-title" className="mx-auto w-full max-w-6xl px-4 lg:px-8">
      <div className="grid gap-6 rounded-3xl border-2 border-dashed border-input p-5 sm:p-8 lg:grid-cols-2 lg:items-start lg:gap-10">
        <div>
          {demo && (
            <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-amber-900 dark:text-amber-100">Data demo</span>
          )}
          <h2 id="data-title" className="mt-3 text-2xl font-bold text-balance">
            {demo ? "Yang kamu lihat di sini adalah contoh, bukan hasil lapangan" : "Angka dari warung dan pesanan sungguhan"}
          </h2>
          <p className="mt-2 leading-relaxed text-muted-foreground">
            {demo
              ? "Warung, menu, dan harga di aplikasi ini diisi data demo untuk mencoba tampilan. Hasil uji coba di warung sungguhan dipisah dan dilaporkan sendiri."
              : "Statistik di samping dihitung dari pesanan yang benar-benar diambil pembeli."}
          </p>
          <Link
            href="/uji-coba"
            className="mt-5 inline-flex h-11 items-center rounded-xl border border-input bg-card px-4 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Lihat hasil uji coba
          </Link>
        </div>
        <ImpactStats />
      </div>
    </section>
  );
}

export function WelcomeView() {
  return (
    <div className="app-backdrop min-h-dvh">
      <PublicHeader />

      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 pt-6 pb-14 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14 lg:px-8 lg:pt-12">
        <section>
          <h1 className="text-[2.2rem] leading-[1.08] font-bold text-balance sm:text-5xl lg:text-6xl">
            Makan malam dari warung dekat kampus, harganya turun sebelum tutup.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">Ambil sendiri di warung. Tanpa kurir, tanpa biaya antar.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/discover"
              className="inline-flex h-12 items-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Lihat menu malam ini
            </Link>
            <Link
              href="/auth/login?role=MERCHANT"
              className="inline-flex h-12 items-center rounded-xl border border-input bg-card px-6 font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Daftarkan warung
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Tamu boleh melihat menu. Masuk hanya perlu saat mengunci porsi.</p>
          <Link
            href="/tour"
            className="mt-3 -ml-1 flex min-h-11 w-fit items-center gap-2.5 rounded-xl py-1 pr-4 pl-1 text-sm font-semibold outline-none transition-colors hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-primary">
              <CirclePlayIcon className="size-5" aria-hidden />
            </span>
            Lihat tur 1 menit
          </Link>
        </section>

        <PriceSliderCard />
      </div>

      <HowItWorks />
      <ForWarung />
      <DemoOrField />

      <div className="mx-auto w-full max-w-6xl px-4 lg:px-8">
        <InstallBanner className="mt-8 lg:max-w-md" />
      </div>

      <PublicFooter />
    </div>
  );
}
