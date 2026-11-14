"use client";

import Link from "next/link";
import { CirclePlayIcon, Clock3Icon, FootprintsIcon } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { PriceTag } from "@/components/common/price-tag";
import { StockBadge } from "@/components/common/stock-badge";
import { ThemeToggle } from "@/components/common/theme-switcher";
import { FoodThumb } from "@/components/customer/food-thumb";
import { InstallBanner } from "@/components/pwa/install-banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalStats } from "@/hooks/use-global-stats";
import { PAY_AT_WARUNG_HOLD_MINUTES, PAYMENT_TTL_SECONDS } from "@/lib/constants";
import { EVENING_CARD_QUOTE, EVENING_EXAMPLE, EVENING_TIMELINE } from "@/lib/pricing/evening-example";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";

const LOCK_MINUTES = Math.round(PAYMENT_TTL_SECONDS / 60);

const EXAMPLE = EVENING_EXAMPLE;
const TIMELINE = EVENING_TIMELINE;

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
      <Link href="/uji-coba" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
        Lihat hasil uji coba di warung sungguhan
      </Link>
    </section>
  );
}

/**
 * What a menu card looks like in the app: an illustration labelled "Contoh", hidden from
 * screen readers. No photo badge: "Foto asli" is only ever claimed for a warung's own upload.
 */
function DealPreview() {
  const q = EVENING_CARD_QUOTE;
  return (
    <div className="relative rounded-3xl bg-card p-3 shadow-card ring-1 ring-border" aria-hidden>
      <span className="absolute top-3 right-3 rounded-full bg-muted px-2 py-1 text-[11px] leading-none font-semibold text-muted-foreground">
        Contoh
      </span>
      <div className="flex gap-3">
        <FoodThumb category="MAKANAN_BERAT" alt="" className="size-20 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate pr-14 text-sm font-semibold">{EXAMPLE.name}</p>
          <p className="truncate text-xs text-muted-foreground">Warung Nasi contoh</p>
          <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
            <span className="font-semibold text-foreground/80">Lauk tersisa:</span> Ayam goreng, Pepes ikan mas
          </p>
          <PriceTag original={EXAMPLE.priceIdr} selling={q.recommendedSellingPriceIdr} discountPct={q.recommendedDiscountPct} className="mt-1.5" />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StockBadge available={3} />
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs leading-none font-semibold text-secondary-foreground tabular-nums">
              <Clock3Icon className="size-3.5 shrink-0" aria-hidden />
              Tutup dalam 01:15:20
            </span>
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <FootprintsIcon className="size-3.5 shrink-0" aria-hidden />
            350 m dari lokasi kamu, bisa jalan kaki
          </p>
        </div>
      </div>
    </div>
  );
}

/** The evening, step by step, priced by the same optimizer the warung uses. */
function EveningTimeline() {
  return (
    <section aria-labelledby="malam-title" className="mt-12 lg:mt-16">
      <h2 id="malam-title" className="text-xl font-bold">
        Harga turun mendekati jam tutup
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Contoh {EXAMPLE.name} seharga {formatIdr(EXAMPLE.priceIdr)}. Harga tidak pernah turun di bawah batas minimum yang
        dipasang warung.
      </p>

      <ol className="mt-5 grid grid-cols-1 gap-x-6 lg:grid-cols-[1fr_1fr_1fr_1.15fr]">
        {TIMELINE.map((step) => (
          <li key={step.when} className="grid grid-cols-[5.5rem_1fr] gap-3 border-t border-border py-4 lg:grid-cols-1 lg:gap-2">
            <p className={cn("text-sm font-extrabold tabular-nums", step.flash ? "text-flash dark:text-flash-accent" : "text-foreground")}>
              {step.when}
            </p>
            <div>
              <p className="flex items-baseline gap-2">
                <span className="text-2xl leading-none font-extrabold tabular-nums">{formatIdr(step.quote.recommendedSellingPriceIdr)}</span>
                <span className="text-sm font-semibold text-muted-foreground tabular-nums">−{step.quote.recommendedDiscountPct}%</span>
              </p>
              <p className="mt-1.5 text-sm leading-snug text-muted-foreground">{step.text}</p>
            </div>
          </li>
        ))}
        <li className="grid grid-cols-[5.5rem_1fr] gap-3 border-t border-border py-4 lg:grid-cols-1 lg:gap-2">
          <p className="text-sm font-semibold">Kamu pesan</p>
          <p className="text-sm leading-snug text-muted-foreground">
            Kunci porsi: bayar QRIS dalam {LOCK_MINUTES} menit, atau bayar tunai di warung dengan porsi ditahan{" "}
            {PAY_AT_WARUNG_HOLD_MINUTES} menit. Tunjukkan QR atau PIN saat ambil. Tidak ada pengantaran.
          </p>
        </li>
      </ol>
    </section>
  );
}

const ROLE_CARDS = [
  {
    href: "/discover",
    title: "Cari makan malam hemat",
    body: "Lihat porsi malam ini dari warung beberapa ratus meter dari kosmu.",
    tone: "bg-primary text-primary-foreground",
    cta: "Lihat menu malam ini",
  },
  {
    href: "/auth/login?role=MERCHANT",
    title: "Daftarkan warungmu",
    body: "Pasang porsi sisa dalam 60 detik. Harga diskonnya dihitung otomatis dan naik sendiri menjelang tutup.",
    tone: "bg-card text-card-foreground ring-1 ring-border",
    cta: "Daftar sebagai mitra",
  },
] as const;

export function WelcomeView() {
  return (
    <div className="app-backdrop min-h-dvh">
      <div className="mx-auto w-full max-w-md px-4 pb-12 lg:max-w-6xl lg:px-8">
        <header className="safe-top flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button asChild variant="ghost" className="h-11 rounded-xl px-2.5 font-semibold">
              <Link href="/tentang">Tentang</Link>
            </Button>
            <Button asChild variant="ghost" className="h-11 rounded-xl px-2.5 font-semibold">
              <Link href="/auth/login">Masuk</Link>
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 pt-4 lg:grid-cols-[1.1fr_1fr] lg:items-start lg:gap-14 lg:pt-12">
          <section className="space-y-5">
            <h1 className="text-[2rem] leading-[1.1] font-bold sm:text-5xl">
              Makan malam kenyang mulai <span className="text-primary">Rp 10.000</span> dari warung terdekat sebelum tutup
            </h1>
            <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
              Isi menunya jelas, porsinya normal, dan kebersihannya dinilai pembeli lain. Kunci porsimu, lalu jalan ke warung
              dekat kos sebelum tutup.
            </p>
            <Link
              href="/tour"
              className="-mt-2 -ml-1 flex min-h-11 w-fit items-center gap-2.5 rounded-xl py-1 pr-4 pl-1 text-sm font-semibold outline-none transition-colors hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-primary">
                <CirclePlayIcon className="size-5" aria-hidden />
              </span>
              Lihat tur 1 menit
            </Link>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ROLE_CARDS.map(({ href, title, body, tone, cta }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex flex-col gap-3 rounded-3xl p-4 shadow-card outline-none transition-[filter] hover:brightness-[0.97] active:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50",
                    tone,
                  )}
                >
                  <span>
                    <span className="block text-lg font-bold">{title}</span>
                    <span className="mt-1 block text-sm leading-snug opacity-80">{body}</span>
                  </span>
                  <span className="mt-auto text-sm font-semibold underline decoration-2 underline-offset-4">{cta}</span>
                </Link>
              ))}
            </div>
          </section>

          <div>
            <DealPreview />
          </div>
        </div>

        <EveningTimeline />

        <div className="mt-8 lg:max-w-md">
          <ImpactStats />
        </div>

        <InstallBanner className="mt-8 lg:max-w-md" />
      </div>
    </div>
  );
}
