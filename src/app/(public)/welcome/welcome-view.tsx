"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CirclePlayIcon, Clock3Icon, CloudIcon, LeafIcon, ReceiptTextIcon, ShoppingBagIcon, StoreIcon } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { PriceTag } from "@/components/common/price-tag";
import { StockBadge } from "@/components/common/stock-badge";
import { ThemeToggle } from "@/components/common/theme-switcher";
import { FoodThumb } from "@/components/customer/food-thumb";
import { InstallBanner } from "@/components/pwa/install-banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { PAYMENT_TTL_SECONDS, SURPLUS_WINDOW_END, SURPLUS_WINDOW_START } from "@/lib/constants";
import type { GlobalStats } from "@/lib/contracts";
import { calculateOptimalRecoveryPrice } from "@/lib/pricing/dynamic-discount";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";

export const GLOBAL_STATS_QUERY_KEY = ["stats", "global"] as const;

const WINDOW_LABEL = `${SURPLUS_WINDOW_START.replace(":", ".")}–${SURPLUS_WINDOW_END.replace(":", ".")} WIB`;
const LOCK_MINUTES = Math.round(PAYMENT_TTL_SECONDS / 60);

/** Example menu for the hero card and the evening timeline. */
const EXAMPLE = { name: "Nasi Timbel Ayam Goreng", priceIdr: 18000, floorIdr: 5000 } as const;

/** Price the real optimizer gives the example menu at a given point in the evening. */
function examplePrice(minutesToClose: number, availableStock: number) {
  return calculateOptimalRecoveryPrice({
    originalPriceIdr: EXAMPLE.priceIdr,
    minRecoveryPriceIdr: EXAMPLE.floorIdr,
    availableStock,
    minutesToClose,
    activeUsersIn2km: 20,
  });
}

const TIMELINE = [
  { when: SURPLUS_WINDOW_START.replace(":", "."), text: "Warung memasang porsi sisa. Harga mulai dari diskon dasar.", quote: examplePrice(150, 10) },
  { when: "1 jam lagi tutup", text: "Masih banyak yang belum laku? Diskon naik sendiri.", quote: examplePrice(60, 6) },
  {
    when: "30 menit lagi",
    text: "Diskon Kilat: potongan terbesar, dan pembeli di sekitar warung dapat notifikasi.",
    quote: examplePrice(30, 5),
    flash: true,
  },
] as const;

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function StatTile({ icon: Icon, value, unit, label }: { icon: ComponentType<{ className?: string }>; value: string; unit?: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-surface p-3">
      <Icon className="size-4 text-primary" aria-hidden />
      <p className="truncate text-xl leading-tight font-extrabold tabular-nums sm:text-2xl">
        {value}
        {unit && <span className="ml-1 text-sm font-bold text-muted-foreground">{unit}</span>}
      </p>
      <p className="text-xs leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

export function ImpactStats() {
  const stats = useQuery({
    queryKey: GLOBAL_STATS_QUERY_KEY,
    queryFn: () => api.get<GlobalStats>("/stats/global"),
    refetchInterval: 30_000,
  });
  const s = stats.data;

  return (
    <section aria-labelledby="dampak-title" className="rounded-3xl bg-card p-4 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dampak-title" className="text-sm font-bold">
          Dampak bersama
        </h2>
        {s?.is_demo_data && (
          <span className="rounded-full bg-warning-soft px-2 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-200">Data demo</span>
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
            <StatTile icon={LeafIcon} value={fmt(s.total_food_saved_grams / 1000, 1)} unit="kg" label="pangan diselamatkan" />
            <StatTile icon={CloudIcon} value={fmt(s.total_co2_avoided_grams / 1000, 1)} unit="kg" label="emisi CO₂e dicegah" />
            <StatTile icon={ReceiptTextIcon} value={fmt(s.total_orders_completed)} label="pesanan diambil" />
            <StatTile icon={StoreIcon} value={fmt(s.active_merchants)} label="warung buka" />
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
      <Link href="/uji-coba" className="mt-1 inline-flex min-h-11 items-center text-sm font-bold text-primary hover:underline">
        Lihat hasil uji coba di warung sungguhan
      </Link>
    </section>
  );
}

/** What a deal card looks like in the app (illustration, hidden from screen readers). */
function DealPreview() {
  const flash = TIMELINE[2].quote;
  return (
    <div className="rounded-3xl bg-card p-3 shadow-card ring-1 ring-border" aria-hidden>
      <div className="flex gap-3">
        <FoodThumb category="MAKANAN_BERAT" alt="" className="size-20 shrink-0 rounded-2xl" iconClassName="size-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{EXAMPLE.name}</p>
          <p className="truncate text-xs text-muted-foreground">Warung contoh · 240 m</p>
          <PriceTag original={EXAMPLE.priceIdr} selling={flash.recommendedSellingPriceIdr} discountPct={flash.recommendedDiscountPct} className="mt-1.5" />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StockBadge available={3} />
            <span className="inline-flex items-center gap-1 rounded-full bg-urgent-soft px-2 py-1 text-xs leading-none font-semibold text-urgent tabular-nums">
              <Clock3Icon className="size-3.5 shrink-0" aria-hidden />
              Tutup 00:28:12
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The evening, step by step, priced by the same optimizer the warung uses. */
function EveningTimeline() {
  return (
    <section aria-labelledby="malam-title" className="mt-12 lg:mt-16">
      <h2 id="malam-title" className="text-xl font-extrabold">
        Harga turun mendekati jam tutup
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Contoh {EXAMPLE.name} seharga {formatIdr(EXAMPLE.priceIdr)}. Harga tidak pernah turun di bawah batas minimum yang
        dipasang warung.
      </p>

      <ol className="mt-5 grid grid-cols-1 gap-x-6 lg:grid-cols-[1fr_1fr_1fr_1.15fr]">
        {TIMELINE.map((step) => (
          <li key={step.when} className="grid grid-cols-[5.5rem_1fr] gap-3 border-t border-border py-4 lg:grid-cols-1 lg:gap-2">
            <p className={cn("text-sm font-extrabold tabular-nums", "flash" in step ? "text-flash dark:text-flash-accent" : "text-foreground")}>
              {step.when}
            </p>
            <div>
              <p className="flex items-baseline gap-2">
                <span className="text-2xl leading-none font-extrabold tabular-nums">{formatIdr(step.quote.recommendedSellingPriceIdr)}</span>
                <span className="text-sm font-bold text-muted-foreground tabular-nums">−{step.quote.recommendedDiscountPct}%</span>
              </p>
              <p className="mt-1.5 text-sm leading-snug text-muted-foreground">{step.text}</p>
            </div>
          </li>
        ))}
        <li className="grid grid-cols-[5.5rem_1fr] gap-3 border-t border-border py-4 lg:grid-cols-1 lg:gap-2">
          <p className="text-sm font-extrabold">Kamu pesan</p>
          <p className="text-sm leading-snug text-muted-foreground">
            Porsimu dikunci {LOCK_MINUTES} menit selama bayar lewat QRIS. Setelah itu datang ke warung dan tunjukkan QR atau kode
            SJ-XXXX. Tidak ada pengantaran.
          </p>
        </li>
      </ol>
    </section>
  );
}

const ROLE_CARDS = [
  {
    href: "/discover",
    title: "Cari makanan hemat",
    body: "Lihat porsi surplus warung dalam radius 2 km dari kampusmu.",
    icon: ShoppingBagIcon,
    tone: "bg-primary text-primary-foreground",
    iconTone: "bg-white/15 text-white",
    cta: "Lihat menu malam ini",
  },
  {
    href: "/auth/login?role=MERCHANT",
    title: "Daftarkan warungmu",
    body: "Pasang porsi sisa dalam 60 detik. Harga diskonnya dihitung otomatis dan naik sendiri menjelang tutup.",
    icon: StoreIcon,
    tone: "bg-card text-card-foreground ring-1 ring-border",
    iconTone: "bg-deal-soft text-deal",
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
            <h1 className="text-[2rem] leading-[1.1] font-extrabold sm:text-5xl">
              Makanan enak tetap <span className="text-primary">termakan</span>, dompet tetap aman.
            </h1>
            <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
              Setiap malam pukul {WINDOW_LABEL}, warung di sekitar kampus menjual porsi yang belum laku dengan potongan
              harga. Kamu pesan dan bayar di aplikasi, lalu ambil sendiri sebelum warung tutup.
            </p>
            <Link
              href="/tour"
              className="-mt-2 -ml-1 flex min-h-11 w-fit items-center gap-2.5 rounded-xl py-1 pr-4 pl-1 text-sm font-bold outline-none transition-colors hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-primary">
                <CirclePlayIcon className="size-5" aria-hidden />
              </span>
              Lihat tur 1 menit
            </Link>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ROLE_CARDS.map(({ href, title, body, icon: Icon, tone, iconTone, cta }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex flex-col gap-3 rounded-3xl p-4 shadow-card outline-none transition-[filter] hover:brightness-[0.97] active:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50",
                    tone,
                  )}
                >
                  <span className={cn("inline-flex size-11 items-center justify-center rounded-2xl", iconTone)}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-base font-extrabold">{title}</span>
                    <span className="mt-1 block text-sm leading-snug opacity-80">{body}</span>
                  </span>
                  <span className="mt-auto text-sm font-bold underline decoration-2 underline-offset-4">{cta}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="space-y-4" aria-label="Contoh dan dampak">
            <DealPreview />
            <ImpactStats />
          </section>
        </div>

        <EveningTimeline />

        <InstallBanner className="mt-8 lg:max-w-md" />
      </div>
    </div>
  );
}
