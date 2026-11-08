"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CloudIcon,
  LeafIcon,
  MapPinnedIcon,
  QrCodeIcon,
  ReceiptTextIcon,
  ShoppingBagIcon,
  StoreIcon,
  WalletIcon,
} from "lucide-react";
import { DiscountBadge } from "@/components/common/discount-badge";
import { Logo } from "@/components/common/logo";
import { PriceTag } from "@/components/common/price-tag";
import { StockBadge } from "@/components/common/stock-badge";
import { InstallBanner } from "@/components/pwa/install-banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { SURPLUS_WINDOW_END, SURPLUS_WINDOW_START } from "@/lib/constants";
import type { GlobalStats } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export const GLOBAL_STATS_QUERY_KEY = ["stats", "global"] as const;

/** Eased count-up from the previous value to `target` (respects reduced motion). */
function useCountUp(target: number, durationMs = 1200): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = from.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    if (reduce || start === target) {
      raf = requestAnimationFrame(() => setValue(target));
      from.current = target;
      return () => cancelAnimationFrame(raf);
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(start + (target - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, durationMs]);

  return value;
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function CounterTile({
  icon: Icon,
  value,
  digits = 0,
  unit,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  value: number;
  digits?: number;
  unit?: string;
  label: string;
}) {
  const shown = useCountUp(value);
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-white/10 p-3 ring-1 ring-white/15">
      <Icon className="size-4 text-white/80" aria-hidden />
      <p className="truncate text-xl leading-tight font-extrabold tabular-nums sm:text-2xl">
        {fmt(shown, digits)}
        {unit && <span className="ml-1 text-sm font-bold text-white/80">{unit}</span>}
      </p>
      <p className="text-[11px] leading-tight text-white/75">{label}</p>
    </div>
  );
}

function HeroImpactCounter() {
  const stats = useQuery({
    queryKey: GLOBAL_STATS_QUERY_KEY,
    queryFn: () => api.get<GlobalStats>("/stats/global"),
    refetchInterval: 30_000,
  });
  const s = stats.data;

  return (
    <section
      aria-label="Dampak Sisa-Saji"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[oklch(0.56_0.14_152)] to-[oklch(0.4_0.1_158)] p-4 text-white shadow-float"
    >
      <div className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-16 -left-8 size-44 rounded-full bg-[oklch(0.75_0.16_60)]/25 blur-2xl" aria-hidden />
      <div className="relative flex items-center justify-between gap-2">
        <p className="text-sm font-bold">Dampak bersama</p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-1 text-[11px] font-semibold">
          <span className="size-1.5 animate-soft-pulse rounded-full bg-[oklch(0.85_0.17_140)]" />
          {s ? `${fmt(s.live_batches)} menu live malam ini` : "Live"}
        </span>
      </div>
      {stats.isPending ? (
        <div className="relative mt-3 grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[5.25rem] rounded-2xl bg-white/15" />
          ))}
        </div>
      ) : stats.isError || !s ? (
        <p className="relative mt-3 rounded-2xl bg-white/10 p-3 text-sm text-white/85">
          Statistik dampak belum bisa dimuat. Yang pasti: setiap porsi yang kamu selamatkan mencegah ±0,5 kg emisi
          CO₂e.
        </p>
      ) : (
        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <CounterTile icon={LeafIcon} value={s.total_food_saved_grams / 1000} digits={1} unit="kg" label="pangan diselamatkan" />
          <CounterTile icon={CloudIcon} value={s.total_co2_avoided_grams / 1000} digits={1} unit="kg" label="emisi CO₂e dicegah" />
          <CounterTile icon={ReceiptTextIcon} value={s.total_orders_completed} label="pesanan diambil" />
          <CounterTile icon={StoreIcon} value={s.active_merchants} label="warung mitra aktif" />
        </div>
      )}
    </section>
  );
}

/** Static "what you'll see" preview card for the hero. */
function DealPreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm" aria-hidden>
      <div className="absolute inset-x-6 -bottom-3 h-full rotate-2 rounded-3xl bg-deal-soft ring-1 ring-deal/15" />
      <div className="relative rounded-3xl bg-card p-3 shadow-float ring-1 ring-border">
        <div className="flex gap-3">
          <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[oklch(0.9_0.08_70)] to-[oklch(0.8_0.12_45)]">
            <ShoppingBagIcon className="size-8 text-white drop-shadow" />
            <DiscountBadge pct={60} size="sm" className="absolute top-1.5 left-1.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">Nasi Ayam Geprek</p>
            <p className="truncate text-xs text-muted-foreground">Warung Bu Sri · 450 m</p>
            <PriceTag original={18000} selling={7000} showBadge={false} className="mt-1.5" />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <StockBadge available={3} />
              <span className="inline-flex items-center gap-1 rounded-full bg-urgent-soft px-2 py-1 text-xs leading-none font-semibold text-urgent tabular-nums">
                Tutup 00:38:12
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ROLE_CARDS = [
  {
    href: "/discover",
    title: "Cari Makanan Hemat",
    body: "Lihat surplus warung dalam radius 2 km, diskon 50–70%.",
    icon: ShoppingBagIcon,
    tone: "bg-primary text-primary-foreground",
    iconTone: "bg-white/15 text-white",
    cta: "Mulai cari",
  },
  {
    href: "/auth/login?role=MERCHANT",
    title: "Daftar Mitra Warung",
    body: "Ubah porsi sisa jadi pemasukan dalam 60 detik, dibantu AI.",
    icon: StoreIcon,
    tone: "bg-card text-card-foreground ring-1 ring-border",
    iconTone: "bg-deal-soft text-deal",
    cta: "Gabung gratis",
  },
] as const;

const STEPS = [
  {
    icon: MapPinnedIcon,
    title: "Temukan",
    body: "Cek peta surplus di sekitar kampus. Harga turun otomatis mendekati jam tutup.",
  },
  {
    icon: WalletIcon,
    title: "Bayar QRIS",
    body: "Porsi dikunci 10 menit untukmu. Bayar pakai QRIS, GoPay, OVO, atau DANA.",
  },
  {
    icon: QrCodeIcon,
    title: "Ambil sendiri",
    body: "Tunjukkan QR atau kode SJ-XXXX di warung. Dampakmu langsung tercatat.",
  },
] as const;

export function WelcomeView() {
  return (
    <div className="app-backdrop min-h-dvh">
      <div className="mx-auto w-full max-w-md px-4 pb-12 lg:max-w-6xl lg:px-8">
        <header className="safe-top flex h-16 items-center justify-between">
          <Logo />
          <Button asChild variant="ghost" className="h-10 rounded-full px-4 font-semibold">
            <Link href="/auth/login">Masuk</Link>
          </Button>
        </header>

        <div className="grid gap-8 pt-4 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-14 lg:pt-12">
          <section className="space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-semibold shadow-soft ring-1 ring-border">
              <span className="size-2 animate-soft-pulse rounded-full bg-deal" />
              Jam selamatkan makanan {SURPLUS_WINDOW_START.replace(":", ".")}–{SURPLUS_WINDOW_END.replace(":", ".")} WIB
            </span>
            <h1 className="text-[2rem] leading-[1.1] font-extrabold sm:text-5xl">
              Makanan enak tetap <span className="text-primary">termakan</span>,{" "}
              <span className="relative whitespace-nowrap text-deal">
                dompet tetap aman.
                <svg
                  viewBox="0 0 200 12"
                  className="absolute -bottom-1.5 left-0 h-2.5 w-full text-deal/40"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path d="M2 9C50 3 150 1 198 7" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
              Sisa-Saji mempertemukan warung di sekitar kampus dengan mahasiswa untuk menyelamatkan porsi surplus
              menjelang tutup. Hemat hingga 70%, ambil sendiri dalam 3 menit.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {ROLE_CARDS.map(({ href, title, body, icon: Icon, tone, iconTone, cta }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group flex flex-col gap-3 rounded-3xl p-4 shadow-card outline-none transition-transform hover:-translate-y-0.5 active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50",
                    tone,
                  )}
                >
                  <span className={cn("inline-flex size-11 items-center justify-center rounded-2xl", iconTone)}>
                    <Icon className="size-5" />
                  </span>
                  <span>
                    <span className="block text-base font-extrabold">{title}</span>
                    <span className="mt-1 block text-sm leading-snug opacity-80">{body}</span>
                  </span>
                  <span className="mt-auto inline-flex items-center gap-1 text-sm font-bold">
                    {cta}
                    <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <DealPreview />
            <HeroImpactCounter />
          </section>
        </div>

        <section aria-labelledby="cara-kerja" className="mt-12">
          <h2 id="cara-kerja" className="text-xl font-extrabold">
            Cara kerjanya
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Tiga langkah, kurang dari 3 menit.</p>
          <ol className="mt-4 grid gap-3 lg:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex gap-3 rounded-3xl bg-card p-4 ring-1 ring-border">
                <span className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-primary">
                  <Icon className="size-5" />
                  <span className="absolute -top-1.5 -left-1.5 inline-flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] font-extrabold text-background">
                    {i + 1}
                  </span>
                </span>
                <span>
                  <span className="block text-sm font-bold">{title}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <InstallBanner className="mt-8 lg:max-w-md" />

        <footer className="mt-10 text-center text-xs text-muted-foreground">
          Setiap porsi yang diselamatkan ≈ 0,5 kg CO₂e lebih sedikit di udara.
        </footer>
      </div>
    </div>
  );
}
