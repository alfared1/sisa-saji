"use client";

/**
 * Phone previews for /tour, one per step. They are illustrations: static,
 * aria-hidden (the slide carries a one-line sr-only description), no store
 * access and no network, except the pembeli welcome screen, which reads the
 * same public /stats/global query as /welcome and shows no numbers until it
 * has real ones. Names and prices come from the demo seed menus.
 */
import type { ComponentType, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgePercentIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  Clock3Icon,
  CloudIcon,
  CloudOffIcon,
  FlameIcon,
  LeafIcon,
  MapPinIcon,
  MinusIcon,
  PackageCheckIcon,
  PlusIcon,
  QrCodeIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  SproutIcon,
  StoreIcon,
  WalletIcon,
} from "lucide-react";
import { DISCOUNT_VARIANT_CLASS, DiscountBadge, discountBadgeState } from "@/components/common/discount-badge";
import { ImpactLine } from "@/components/common/impact-line";
import { Logo, LogoMark } from "@/components/common/logo";
import { PriceTag } from "@/components/common/price-tag";
import { QrCodeView } from "@/components/common/qr-code-view";
import { StockBadge } from "@/components/common/stock-badge";
import { FoodThumb } from "@/components/customer/food-thumb";
import { api } from "@/lib/api/client";
import { CAMPUSES, PLATFORM_COMMISSION_DEFAULT_IDR } from "@/lib/constants";
import type { GlobalStats, MenuCategory } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Coachmark } from "./coachmark";
import {
  HERO_KG,
  LOCK_MINUTES,
  PORTION_CO2,
  RADIUS_KM,
  SAVER_KG,
  SURPLUS_WINDOW_LABEL,
  keepTogether,
  type TourMockId,
} from "./tour-steps";

/**
 * Same key and fetcher as the /welcome impact counter (and customerKeys.globalStats),
 * so they share one cached request. Spelled out here rather than imported:
 * welcome-view is a page module, and customer/lib/queries pulls in the cart store.
 */
const GLOBAL_STATS_QUERY_KEY = ["stats", "global"] as const;

const DEMO_WARUNG = "Warung Nasi Teh Euis";
const TIMBEL = "Nasi Timbel Ayam Goreng + Sayur Asem";
const TIMBEL_PRICE = 18_000;
const TIMBEL_RECOVERY = 9_000;
/** Minimum price the demo seed sets for every menu: 30 % of the normal price, rounded up to Rp 500. */
const TIMBEL_FLOOR = Math.ceil((TIMBEL_PRICE * 0.3) / 500) * 500;

function fmtNumber(n: number, digits = 0): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Live totals grow past a tonne: "820 kg", "5,7 ton" (fits a three-up strip). */
function fmtMass(grams: number): string {
  const kg = grams / 1000;
  if (kg >= 1000) return `${fmtNumber(kg / 1000, 1)} ton`;
  return `${fmtNumber(kg, kg < 10 ? 1 : 0)} kg`;
}

const CARD = "rounded-2xl bg-card ring-1 ring-border";

function ScreenTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <p className="text-[16px] font-extrabold tracking-tight">{children}</p>
      {aside}
    </div>
  );
}

function Stepper({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-card text-muted-foreground shadow-soft">
        <MinusIcon className="size-3.5" />
      </span>
      <span className="w-7 text-center text-[15px] font-extrabold tabular-nums">{value}</span>
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft">
        <PlusIcon className="size-3.5" />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Pembeli                                                             */
/* ------------------------------------------------------------------ */

function SambutMock() {
  const stats = useQuery({
    queryKey: GLOBAL_STATS_QUERY_KEY,
    queryFn: () => api.get<GlobalStats>("/stats/global"),
    staleTime: 60_000,
  });
  const s = stats.data;
  // Real numbers only: while loading, on error or before the first pickup, the strip shows plain copy.
  const live = s && s.total_orders_completed > 0 ? s : null;

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between pt-1">
        <Logo markClassName="size-8" />
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[11px] font-semibold ring-1 ring-border">
          <MapPinIcon className="size-3.5 text-primary" />
          IPB Dramaga
        </span>
      </div>

      {/* Stays dark green in both themes, so white text keeps its contrast. */}
      <section className="flex min-h-[86px] flex-col justify-center rounded-2xl bg-impact p-3 text-white">
        <p className="text-[12px] font-bold">Dampak bersama{live?.is_demo_data ? " (data demo)" : ""}</p>
        {live ? (
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            <LiveStat value={fmtMass(live.total_food_saved_grams)} label="pangan" />
            <LiveStat value={fmtMass(live.total_co2_avoided_grams)} label="CO₂e dicegah" />
            <LiveStat value={fmtNumber(live.total_orders_completed)} label="pesanan" />
          </div>
        ) : (
          <p className="mt-1 text-[12px] leading-snug text-white">
            {keepTogether(`Setiap porsi yang diselamatkan mencegah ±${PORTION_CO2} emisi CO₂e.`)}
          </p>
        )}
      </section>

      {/* Bottom margin = room for the callout, so it does not cover the deal card below. */}
      <Coachmark label="Surplus muncul tiap malam di jam ini" radius="rounded-full" align="start" className="mb-[calc(62px/var(--z))]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-[12px] font-semibold shadow-soft ring-1 ring-border">
          <Clock3Icon className="size-3.5 text-deal" />
          Jam surplus {keepTogether(SURPLUS_WINDOW_LABEL)}
        </span>
      </Coachmark>

      <div className={cn(CARD, "p-2.5 shadow-soft")}>
        <FoodThumb category="MAKANAN_BERAT" alt={TIMBEL} className="h-28 rounded-xl" iconClassName="size-12">
          <DiscountBadge pct={50} minutesToClose={null} className="absolute top-2 left-2" />
        </FoodThumb>
        <p className="mt-2 truncate text-[13px] font-bold">{TIMBEL}</p>
        <p className="truncate text-[11px] text-muted-foreground">{DEMO_WARUNG} · 240 m</p>
        <PriceTag original={TIMBEL_PRICE} selling={TIMBEL_RECOVERY} showBadge={false} className="mt-1" />
      </div>
    </div>
  );
}

function LiveStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/12 px-2 py-1.5">
      <p className="text-[14px] leading-tight font-extrabold whitespace-nowrap tabular-nums">{value}</p>
      <p className="text-[10px] leading-tight text-white">{label}</p>
    </div>
  );
}

type Deal = {
  name: string;
  warung: string;
  distance: string;
  category: MenuCategory;
  original: number;
  selling: number;
  pct: number;
  stock: number;
  grams: number;
};

/**
 * The highlighted deal, drawn like a /discover card: photo on top with the
 * discount badge over it. The badge's callout then lands on the photo (the
 * least important part), so price, the "Hampir Habis!" stock label and the
 * impact line stay readable under it.
 */
function DealCard({ deal: d, coach }: { deal: Deal; coach: string }) {
  return (
    <div className={cn(CARD, "p-2.5 shadow-soft")}>
      {/* The badge sits beside the photo, not inside it: FoodThumb clips its children. */}
      <div className="relative">
        <FoodThumb category={d.category} alt={d.name} className="h-28 rounded-xl" iconClassName="size-11" />
        <Coachmark label={coach} radius="rounded-full" align="start" className="absolute top-2 left-2">
          <DiscountBadge pct={d.pct} minutesToClose={null} size="sm" />
        </Coachmark>
      </div>
      <p className="mt-2 truncate text-[13px] font-bold">{d.name}</p>
      <p className="truncate text-[11px] text-muted-foreground">
        {d.warung} · {d.distance}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <PriceTag original={d.original} selling={d.selling} showBadge={false} size="sm" />
        <StockBadge available={d.stock} />
      </div>
      <ImpactLine portionWeightGrams={d.grams} className="mt-1.5" />
    </div>
  );
}

/** A compact list row for the deals under the highlighted one. */
function DealRow({ deal: d }: { deal: Deal }) {
  return (
    <div className={cn(CARD, "flex gap-2.5 p-2.5 shadow-soft")}>
      <FoodThumb category={d.category} alt={d.name} className="size-[68px] shrink-0 rounded-xl" iconClassName="size-7" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold">{d.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {d.warung} · {d.distance}
        </p>
        <PriceTag original={d.original} selling={d.selling} showBadge={false} size="sm" className="mt-0.5" />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <DiscountBadge pct={d.pct} minutesToClose={null} size="sm" />
          <StockBadge available={d.stock} />
        </div>
        <ImpactLine portionWeightGrams={d.grams} className="mt-1.5" />
      </div>
    </div>
  );
}

const AYAM_BAKAR: Deal = {
  name: "Nasi Box Ayam Bakar Kecap",
  warung: "Dapur Ceu Popon",
  distance: "650 m",
  category: "MAKANAN_BERAT",
  original: 20_000,
  selling: 6_000,
  pct: 70,
  stock: 2,
  grams: 300,
};

const TIMBEL_DEAL: Deal = {
  name: TIMBEL,
  warung: DEMO_WARUNG,
  distance: "240 m",
  category: "MAKANAN_BERAT",
  original: TIMBEL_PRICE,
  selling: TIMBEL_RECOVERY,
  pct: 50,
  stock: 4,
  grams: 300,
};

function CariMock() {
  const campus = CAMPUSES[0];
  return (
    <div className="space-y-3">
      {/* Same header as /discover: "Ambil di sekitar", the campus, and the dark radius pill. */}
      <div className="flex items-center gap-2.5 pt-1">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary">
          <MapPinIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-muted-foreground">Ambil di sekitar</p>
          <p className="flex items-center gap-1 text-[13px] font-bold">
            <span className="truncate">{campus.name}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </p>
        </div>
        <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-foreground px-3 text-[12px] font-bold text-background tabular-nums">
          {RADIUS_KM} km
          <ChevronDownIcon className="size-3.5" />
        </span>
      </div>
      <div className="pt-1">
        <p className="flex items-center gap-1.5 text-[15px] leading-tight font-extrabold tracking-tight">
          <FlameIcon className="size-4 shrink-0 text-urgent" />
          Hampir Habis &amp; Diskon Tertinggi
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Segera tutup atau diskon 60% ke atas</p>
      </div>
      <DealCard deal={AYAM_BAKAR} coach="Harga turun otomatis menjelang tutup" />
      <DealRow deal={TIMBEL_DEAL} />
    </div>
  );
}

function PesanMock() {
  const total = TIMBEL_RECOVERY + PLATFORM_COMMISSION_DEFAULT_IDR;
  return (
    <div className="space-y-3">
      {/* Quick-order sheet: grab handle, no title, so "Bayar QRIS" stays in view on small phones. */}
      <span className="mx-auto mt-1 block h-1 w-10 rounded-full bg-border" />
      {/* Bottom margin = room for the callout above "Bayar QRIS" (sized in on-screen px via --z). */}
      <div className={cn(CARD, "mb-[calc(72px/var(--z))] p-2.5")}>
        <div className="flex gap-2.5">
          <FoodThumb category="MAKANAN_BERAT" alt={TIMBEL} className="size-14 shrink-0 rounded-xl" iconClassName="size-6" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[13px] leading-snug font-bold">{TIMBEL}</p>
            <p className="truncate text-[11px] text-muted-foreground">{DEMO_WARUNG}</p>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <PriceTag original={TIMBEL_PRICE} selling={TIMBEL_RECOVERY} discountPct={50} size="sm" />
          <Stepper value={1} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-card p-2.5 pl-3.5 shadow-card ring-1 ring-border">
        <div className="min-w-0">
          <p className="text-[16px] font-extrabold whitespace-nowrap tabular-nums">{formatIdr(total)}</p>
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            termasuk biaya layanan <span className="whitespace-nowrap">{formatIdr(PLATFORM_COMMISSION_DEFAULT_IDR)}</span>
          </p>
        </div>
        <Coachmark label={`Porsi dikunci ${LOCK_MINUTES} menit untukmu`} side="top" align="end" radius="rounded-full" className="shrink-0">
          <span className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-bold whitespace-nowrap text-primary-foreground">
            <QrCodeIcon className="size-4" />
            Bayar QRIS
          </span>
        </Coachmark>
      </div>
    </div>
  );
}

function AmbilMock() {
  return (
    <article className="overflow-hidden rounded-[1.6rem] bg-card shadow-card ring-1 ring-border">
      <div className="flex items-center gap-2.5 bg-brand-soft px-3 py-2.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-soft">
          <StoreIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-extrabold">{DEMO_WARUNG}</p>
          <p className="text-[11px] text-muted-foreground">2× Nasi Timbel · ambil sebelum 22.30</p>
        </div>
      </div>
      <div className="flex flex-col items-center px-4 pt-3 pb-4 text-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-1 text-[11px] font-bold text-brand-strong ring-1 ring-primary/25">
          <CloudOffIcon className="size-3.5" />
          Tersimpan offline
        </span>
        <p className="mt-2.5 text-[11px] font-bold tracking-[0.16em] text-muted-foreground uppercase">Kode pengambilan</p>
        <Coachmark label="Tunjukkan ke kasir warung" radius="rounded-2xl" className="mt-1.5">
          <span className="px-2 py-0.5 text-[40px] leading-none font-black tracking-[0.08em] tabular-nums">SJ-8515</span>
        </Coachmark>
        <QrCodeView value="SISA-SAJI TUR CONTOH SJ-8515" size={120} label="Kode QR contoh" className="mt-[calc(52px/var(--z))]" />
      </div>
    </article>
  );
}

/** Sample progress: 3,2 kg saved, between Surplus Saver and Surplus Hero. */
const DEMO_SAVED_KG = 3.2;

const LEVELS = [
  { label: "Rookie", state: "done" },
  { label: "Saver", state: "current" },
  { label: "Hero", state: "next" },
] as const;

function DampakMock() {
  return (
    <div className="space-y-3">
      <ScreenTitle>Dampakmu</ScreenTitle>
      {/* Level first, then a gap for the callout, then the totals. */}
      <div className={cn(CARD, "mb-[calc(66px/var(--z))] p-3 shadow-soft")}>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-primary">
            <SproutIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">Level kamu</p>
            <p className="text-[16px] font-extrabold">Surplus Saver</p>
          </div>
        </div>
        <Coachmark
          block
          label={`Naik level di ${fmtNumber(SAVER_KG, 1)} kg dan ${fmtNumber(HERO_KG, 1)} kg`}
          radius="rounded-xl"
          className="mt-3"
        >
          <div className="w-full px-1 py-0.5">
            <div className="flex items-baseline justify-between text-[11px] font-semibold">
              <span className="tabular-nums">{fmtNumber(DEMO_SAVED_KG, 1)} kg</span>
              <span className="text-muted-foreground">Hero di {fmtNumber(HERO_KG, 1)} kg</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (DEMO_SAVED_KG / HERO_KG) * 100)}%` }} />
            </div>
            <ol className="mt-2 flex items-center justify-between">
              {LEVELS.map((l, i) => (
                <li key={l.label} className="flex flex-1 items-center gap-1 last:flex-none">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                      l.state === "done" && "bg-brand-soft text-brand-strong",
                      l.state === "current" && "bg-primary text-primary-foreground",
                      l.state === "next" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {l.state === "done" && <CheckIcon className="size-3" />}
                    {l.label}
                  </span>
                  {i < LEVELS.length - 1 && <span className="h-px flex-1 bg-border" />}
                </li>
              ))}
            </ol>
          </div>
        </Coachmark>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ImpactTile icon={LeafIcon} value={`${fmtNumber(DEMO_SAVED_KG, 1)} kg`} label="pangan" />
        <ImpactTile icon={CloudIcon} value="8 kg" label="CO₂e dicegah" />
        <ImpactTile icon={WalletIcon} value="Rp 96rb" label="dihemat" />
      </div>
    </div>
  );
}

function ImpactTile({ icon: Icon, value, label }: { icon: ComponentType<{ className?: string }>; value: string; label: string }) {
  return (
    <div className={cn(CARD, "min-w-0 p-2.5")}>
      <Icon className="size-4 text-primary" />
      <p className="mt-1 text-[14px] font-extrabold whitespace-nowrap tabular-nums">{value}</p>
      <p className="text-[10.5px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mitra Warung                                                        */
/* ------------------------------------------------------------------ */

const PICKED_UP = [
  { code: "SJ-8515", portions: 2 },
  { code: "SJ-3027", portions: 3 },
  { code: "SJ-6190", portions: 3 },
] as const;

function GabungMock() {
  const portions = PICKED_UP.reduce((n, o) => n + o.portions, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 pt-1">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <StoreIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-extrabold">{DEMO_WARUNG}</p>
          <p className="text-[11px] text-muted-foreground">Tutup pukul 22.30</p>
        </div>
        <span className="rounded-full bg-brand-soft px-2 py-1 text-[11px] font-bold text-brand-strong">Buka</span>
      </div>
      <Coachmark block label="Masuk ke saldo setelah pesanan diambil" radius="rounded-2xl" className="mb-[calc(72px/var(--z))]">
        <div className={cn(CARD, "w-full p-3 shadow-soft")}>
          <p className="text-[11px] font-semibold text-muted-foreground">Saldo warung</p>
          <p className="text-[26px] leading-tight font-extrabold tabular-nums">{formatIdr(portions * TIMBEL_RECOVERY)}</p>
          <p className="text-[11px] font-semibold text-brand-strong">dari {portions} porsi surplus malam ini</p>
        </div>
      </Coachmark>
      <div className={cn(CARD, "divide-y divide-border px-3")}>
        <p className="py-2 text-[12px] font-bold">Pesanan diambil</p>
        {PICKED_UP.map((o) => (
          <div key={o.code} className="flex items-center gap-2 py-2 text-[12px]">
            <CircleCheckIcon className="size-4 shrink-0 text-primary" />
            <span className="font-bold tabular-nums">{o.code}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{o.portions}× Nasi Timbel</span>
            <span className="font-bold whitespace-nowrap tabular-nums">{formatIdr(o.portions * TIMBEL_RECOVERY)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const MENU_CHOICES = ["Nasi Timbel", "Pepes Ikan Mas", "Paket Kejutan"] as const;

function PublikasiMock() {
  return (
    <div className="space-y-3">
      <div className={cn(CARD, "mt-1 flex items-center justify-between gap-2 p-2 pl-2.5")}>
        <div className="min-w-0">
          <p className="text-[10.5px] text-muted-foreground">Menu · {MENU_CHOICES.length} pilihan</p>
          <p className="flex items-center gap-1 text-[13px] font-bold">
            {MENU_CHOICES[0]}
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </p>
        </div>
        <Stepper value={8} />
      </div>
      <div className={cn(CARD, "mb-[calc(70px/var(--z))] p-3 shadow-soft")}>
        {/* Same header as the publisher's "Saran harga" card. */}
        <p className="flex items-center gap-2 text-[13px] font-bold">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-brand-soft text-primary">
            <BadgePercentIcon className="size-4" aria-hidden />
          </span>
          Saran harga
        </p>
        <p className="mt-2.5 flex items-start gap-1.5 rounded-xl bg-muted px-2.5 py-2 text-[11px] leading-snug font-medium text-muted-foreground">
          <ShieldCheckIcon className="mt-px size-3.5 shrink-0" />
          <span>
            Tidak pernah di bawah harga minimum <span className="whitespace-nowrap">{formatIdr(TIMBEL_FLOOR)}</span>.
          </span>
        </p>
        <Coachmark label="Saran harga, bisa kamu ubah" align="start" radius="rounded-xl" className="mt-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 py-0.5">
            <span className="text-[26px] leading-none font-extrabold tabular-nums">{formatIdr(TIMBEL_RECOVERY)}</span>
            <span className="text-[12px] text-muted-foreground tabular-nums line-through">{formatIdr(TIMBEL_PRICE)}</span>
            <DiscountBadge pct={50} minutesToClose={null} />
          </div>
        </Coachmark>
      </div>
      <span className="flex h-11 items-center justify-center rounded-full bg-primary text-[14px] font-bold text-primary-foreground">
        Publikasikan Sekarang
      </span>
    </div>
  );
}

/** 18.000 → floor-safe recovery price rounded up to Rp 500 (same rule as the optimizer). */
const ESCALATION = [
  { time: "20.00", minutes: 150, pct: 50 },
  { time: "20.30", minutes: 120, pct: 50 },
  { time: "21.00", minutes: 90, pct: 55 },
  { time: "21.30", minutes: 60, pct: 60 },
  { time: "22.00", minutes: 30, pct: 70 },
].map((s) => ({ ...s, price: Math.ceil((TIMBEL_PRICE * (100 - s.pct)) / 100 / 500) * 500 }));

function EskalasiMock() {
  return (
    <div className="space-y-3">
      {/* The curve first (with its time axis and the 22.30 closing mark), the push it triggers below. */}
      <div className={cn(CARD, "mt-1 p-3 shadow-soft")}>
        <p className="text-[12px] font-bold text-muted-foreground">Kurva harga otomatis</p>
        {/* Top margin = room for the callout above the 70% column. */}
        <ol className="mt-[calc(58px/var(--z))] flex items-end gap-1.5">
          {ESCALATION.map((s, i) => {
            const variant = discountBadgeState(s.pct, s.minutes).variant;
            const column = (
              <span className="flex w-full flex-col items-center gap-1">
                <span className="text-[11px] font-extrabold tabular-nums">{s.pct}%</span>
                <span
                  className={cn(
                    "flex w-full items-end justify-center rounded-t-lg rounded-b-sm pb-1 text-[10px] font-bold text-white tabular-nums",
                    DISCOUNT_VARIANT_CLASS[variant],
                  )}
                  style={{ height: 26 + ((s.pct - 45) / 25) * 70 }}
                >
                  {fmtNumber(s.price / 1000, 1)}rb
                </span>
              </span>
            );
            return (
              <li key={s.time} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                {i === ESCALATION.length - 1 ? (
                  <Coachmark block label="Sisa porsi tetap laku" side="top" align="end" radius="rounded-lg">
                    {column}
                  </Coachmark>
                ) : (
                  column
                )}
                <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">{s.time}</span>
              </li>
            );
          })}
          <li className="flex w-9 shrink-0 flex-col items-center gap-1">
            <span className="h-[112px] w-px border-l-2 border-dashed border-border" />
            <span className="text-[10px] font-bold text-urgent tabular-nums">22.30</span>
          </li>
        </ol>
        <p className="mt-2.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <ShieldCheckIcon className="size-3.5 shrink-0 text-primary" />
          Harga tidak pernah di bawah harga minimummu
        </p>
      </div>
      <div className="flex gap-2.5 rounded-2xl bg-card p-2.5 shadow-card ring-1 ring-border">
        <LogoMark className="size-8 rounded-lg" title="" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-bold text-foreground">Sisa-Saji</span>
            <span>sekarang</span>
          </p>
          <p className="text-[12px] leading-snug font-bold">Flash Rescue 70% di {DEMO_WARUNG}</p>
          <p className="text-[11px] leading-snug text-muted-foreground">Nasi Timbel tinggal 5 porsi. Ambil sebelum 22.30.</p>
        </div>
      </div>
    </div>
  );
}

function SerahkanMock() {
  return (
    <div className="space-y-3">
      <ScreenTitle
        aside={
          <span className="inline-flex items-center gap-1 rounded-full bg-[#18201c] px-2.5 py-1.5 text-[11px] font-bold text-white">
            <ScanLineIcon className="size-3.5" />
            Pindai QR
          </span>
        }
      >
        Serahkan pesanan
      </ScreenTitle>
      <p className="text-center text-[11px] font-semibold text-muted-foreground">Kode dari tiket pembeli</p>
      {/* Bottom margin = room for the callout under the code. */}
      <div className="mb-[calc(70px/var(--z))] flex justify-center">
        <Coachmark label="Kamera bermasalah? Ketik 4 digitnya" radius="rounded-2xl">
          <div className="flex items-center gap-1.5 px-1 py-0.5">
            <span className="text-[22px] font-extrabold text-muted-foreground">SJ-</span>
            {"8515".split("").map((d, i) => (
              <span
                key={i}
                className="inline-flex size-11 items-center justify-center rounded-xl bg-card text-[22px] font-extrabold tabular-nums ring-1 ring-primary/40"
              >
                {d}
              </span>
            ))}
          </div>
        </Coachmark>
      </div>
      <div className="flex items-center gap-2.5 rounded-2xl bg-brand-soft p-3 ring-1 ring-primary/25">
        <CircleCheckIcon className="size-7 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-[14px] font-extrabold">Pesanan cocok</p>
          <p className="text-[11px] text-muted-foreground">Lunas · ambil sebelum 22.30</p>
        </div>
      </div>
      {/* What to hand over, then the same "Selesaikan Pesanan" step as the real scan screen. */}
      <div className={cn(CARD, "p-2.5")}>
        <p className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
          <span>Serahkan</span>
          <span className="tabular-nums">2 porsi</span>
        </p>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="inline-flex h-9 min-w-11 items-center justify-center rounded-xl bg-primary px-2 text-[16px] font-extrabold text-primary-foreground tabular-nums">
            2×
          </span>
          <span className="min-w-0 flex-1 text-[13px] leading-snug font-bold">{TIMBEL}</span>
        </div>
      </div>
      <span className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-[14px] font-extrabold text-primary-foreground">
        <PackageCheckIcon className="size-5" />
        Selesaikan Pesanan
      </span>
      <p className="text-center text-[11px] text-muted-foreground">
        <span className="whitespace-nowrap">{formatIdr(2 * TIMBEL_RECOVERY)}</span> masuk saldo setelah selesai
      </p>
    </div>
  );
}

const WEEK = [
  { day: "Sen", sold: 6, wasted: 2 },
  { day: "Sel", sold: 8, wasted: 1 },
  { day: "Rab", sold: 5, wasted: 2 },
  { day: "Kam", sold: 9, wasted: 1 },
  { day: "Jum", sold: 11, wasted: 1 },
  { day: "Sab", sold: 14, wasted: 0 },
  { day: "Min", sold: 7, wasted: 1 },
] as const;

function AnalitikMock() {
  const sold = WEEK.reduce((n, d) => n + d.sold, 0);
  const max = Math.max(...WEEK.map((d) => d.sold + d.wasted));
  return (
    <div className="space-y-3">
      <ScreenTitle aside={<span className="rounded-full bg-muted px-2 py-1 text-[11px] font-bold">7 hari</span>}>Analitik</ScreenTitle>
      <div className="mb-[calc(70px/var(--z))] grid grid-cols-2 gap-2">
        <Coachmark block label="Dari porsi yang tadinya terbuang" radius="rounded-2xl" align="start">
          <div className={cn(CARD, "w-full p-2.5 shadow-soft")}>
            <p className="text-[10.5px] leading-tight text-muted-foreground">Pendapatan dipulihkan</p>
            <p className="mt-1 text-[16px] font-extrabold whitespace-nowrap tabular-nums">{formatIdr(sold * TIMBEL_RECOVERY)}</p>
          </div>
        </Coachmark>
        <div className={cn(CARD, "p-2.5")}>
          <p className="text-[10.5px] leading-tight text-muted-foreground">Pangan diselamatkan</p>
          <p className="mt-1 text-[16px] font-extrabold tabular-nums">{fmtNumber((sold * 200) / 1000, 1)} kg</p>
        </div>
      </div>
      <div className={cn(CARD, "p-3")}>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary" /> Terjual
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-urgent/70" /> Terbuang
          </span>
        </div>
        <ol className="mt-3 flex h-28 items-end gap-2">
          {WEEK.map((d) => (
            <li key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="flex w-full flex-col justify-end overflow-hidden rounded-t-md" style={{ height: `${((d.sold + d.wasted) / max) * 100}%` }}>
                {d.wasted > 0 && <span className="w-full bg-urgent/70" style={{ height: `${(d.wasted / (d.sold + d.wasted)) * 100}%` }} />}
                <span className="w-full flex-1 bg-primary" />
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground">{d.day}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export type TourMock = {
  Mock: ComponentType;
  /**
   * Artboard y (px from the top of the screen content, under the status bar)
   * of the highlighted element's lowest edge. PhoneFrame scrolls the screen
   * so that it stays above the stage's bottom fade on short phones.
   */
  focusY: number;
  /**
   * On-screen px kept visible under focusY: room for a callout below its
   * target, plus any callout gap above the target (those are sized in
   * on-screen px through --z, so they cannot be part of focusY).
   */
  focusBelow: number;
  /** Status-bar clock, matched to the moment the screen shows. */
  clock: string;
};

/** A callout under its target: 1.1em gap + up to two lines (3.8em) at 13–14 px, plus air. */
const CALLOUT_BELOW = 74;
/** Nothing below the focus edge (a callout above its target, or a label under the callout): a little air. */
const CLEAR = 10;

// focusY values are measured from the rendered mocks (artboard px); re-measure after changing a mock's layout.
export const TOUR_MOCKS: Record<TourMockId, TourMock> = {
  "pembeli-sambut": { Mock: SambutMock, focusY: 201, focusBelow: CALLOUT_BELOW, clock: "20.41" },
  // The "Hampir Habis!" label under the photo, so badge, callout and stock label all show.
  "pembeli-cari": { Mock: CariMock, focusY: 325, focusBelow: CLEAR, clock: "20.41" },
  // "Bayar QRIS" sits under the 72 px callout gap of the order card.
  "pembeli-pesan": { Mock: PesanMock, focusY: 227, focusBelow: CLEAR + 72, clock: "20.41" },
  "pembeli-ambil": { Mock: AmbilMock, focusY: 173, focusBelow: CALLOUT_BELOW, clock: "21.50" },
  "pembeli-dampak": { Mock: DampakMock, focusY: 172, focusBelow: CALLOUT_BELOW, clock: "20.41" },
  "mitra-gabung": { Mock: GabungMock, focusY: 149, focusBelow: CALLOUT_BELOW, clock: "20.41" },
  "mitra-publikasi": { Mock: PublikasiMock, focusY: 238, focusBelow: CALLOUT_BELOW, clock: "20.41" },
  // The time axis under the bars (so the curve reads to its 22.00 step); the columns sit under a 58 px callout gap.
  "mitra-eskalasi": { Mock: EskalasiMock, focusY: 174, focusBelow: CLEAR + 58, clock: "22.00" },
  "mitra-serahkan": { Mock: SerahkanMock, focusY: 125, focusBelow: CALLOUT_BELOW, clock: "20.41" },
  "mitra-analitik": { Mock: AnalitikMock, focusY: 119, focusBelow: CALLOUT_BELOW, clock: "20.41" },
};
