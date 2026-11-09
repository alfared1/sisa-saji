"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { MoreHorizontalIcon, ShareIcon, Trash2Icon } from "lucide-react";
import { CategoryChips } from "@/components/common/category-chips";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { useAddToCart } from "@/components/common/diff-merchant-dialog";
import { DiscountBadge } from "@/components/common/discount-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { FloatingCartBar } from "@/components/common/floating-cart-bar";
import { ImpactStat } from "@/components/common/impact-stat";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { LocationPill } from "@/components/common/location-pill";
import { Logo } from "@/components/common/logo";
import { Money } from "@/components/common/money";
import { PageHeader } from "@/components/common/page-header";
import { PriceTag } from "@/components/common/price-tag";
import { QrCodeView } from "@/components/common/qr-code-view";
import { StockBadge } from "@/components/common/stock-badge";
import { VerifiedBadge } from "@/components/common/verified-badge";
import { LocationPickerMap } from "@/components/map/location-picker-map";
import { SurplusMap, type LatLng, type SurplusMapMarker } from "@/components/map/surplus-map";
import { InstallBanner } from "@/components/pwa/install-banner";
import { Button } from "@/components/ui/button";
import { useCountdown } from "@/hooks/use-countdown";
import { useNow } from "@/hooks/use-now";
import { ApiClientError } from "@/lib/api/client";
import { CAMPUSES } from "@/lib/constants";
import type { MenuCategory } from "@/lib/contracts";
import { type CartItem, useCartStore } from "@/stores/cart";
import { useLocationStore } from "@/stores/location";

const HOME = CAMPUSES[0];

/** Demo markers around IPB Dramaga (the default point), closing times relative to `now`. */
function demoMarkers(nowMs: number): SurplusMapMarker[] {
  const at = (min: number) => new Date(nowMs + min * 60_000).toISOString();
  return [
    { id: "m1", name: "Warung Nasi Teh Euis", lat: HOME.lat + 0.004, lng: HOME.lng - 0.003, discount_pct: 60, stock: 3, closes_at: at(30), is_verified: true },
    { id: "m2", name: "Geprek Bateng", lat: HOME.lat - 0.005, lng: HOME.lng + 0.004, discount_pct: 50, stock: 8, closes_at: at(110) },
    { id: "m3", name: "Roti Babakan Raya", lat: HOME.lat + 0.008, lng: HOME.lng + 0.006, discount_pct: 35, stock: 12, closes_at: at(140) },
    { id: "m4", name: "Soto Kuning Dramaga", lat: HOME.lat - 0.009, lng: HOME.lng - 0.006, discount_pct: 70, stock: 2, closes_at: at(15) },
    { id: "m5", name: "Bandrek Balebak", lat: HOME.lat + 0.001, lng: HOME.lng + 0.011, discount_pct: 55, stock: 0, closes_at: at(80) },
  ];
}

function demoItem(nowMs: number, batch: string, name: string, price: number, original: number): CartItem {
  return {
    batch_id: batch,
    menu_id: `menu-${batch}`,
    menu_name: name,
    quantity: 1,
    unit_price_idr: price,
    original_price_idr: original,
    discount_pct: Math.round(((original - price) / original) * 100),
    max_quantity: 4,
    portion_weight_grams: 250,
    pickup_end_time: new Date(nowMs + 90 * 60_000).toISOString(),
  };
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-3 rounded-3xl bg-card p-4 ring-1 ring-border">
      <h2 className="text-sm font-extrabold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

const SWATCHES = [
  ["primary", "bg-primary"],
  ["brand-soft", "bg-brand-soft"],
  ["deal", "bg-deal"],
  ["deal-soft", "bg-deal-soft"],
  ["urgent", "bg-urgent"],
  ["urgent-soft", "bg-urgent-soft"],
  ["warning", "bg-warning"],
  ["muted", "bg-muted"],
  ["surface", "bg-surface"],
  ["foreground", "bg-foreground"],
] as const;

function CountdownHookDemo({ target }: { target: string }) {
  const c = useCountdown(target);
  return (
    <p className="text-sm">
      useCountdown: <b className="tabular-nums">{c.label}</b> · urgent: {String(c.isUrgent)} · over: {String(c.isOver)}
    </p>
  );
}

export function DevGallery() {
  const now = useNow(60_000);
  const [category, setCategory] = useState<MenuCategory | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>("m1");
  const [pin, setPin] = useState<LatLng | null>(null);
  const { addToCart, dialog } = useAddToCart();
  const clearCart = useCartStore((s) => s.clear);
  const loc = useLocationStore();

  const markers = useMemo(() => (now ? demoMarkers(now) : []), [now]);
  const at = (min: number) => (now ? new Date(now + min * 60_000).toISOString() : null);
  const soon = at(25);
  const later = at(130);
  const past = at(-5);

  return (
    <div className="app-backdrop min-h-dvh">
      <div className="mx-auto w-full max-w-md space-y-4 px-4 pb-40">
        <PageHeader
          title="Galeri Komponen"
          subtitle="Hanya untuk development"
          backHref="/welcome"
          transparent
          actions={
            <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label="Lainnya">
              <MoreHorizontalIcon />
            </Button>
          }
        />
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <Link className="rounded-full bg-card px-3 py-1.5 ring-1 ring-border" href="/dev-ui/customer-shell">
            Preview CustomerShell
          </Link>
          <Link className="rounded-full bg-card px-3 py-1.5 ring-1 ring-border" href="/dev-ui/merchant-shell">
            Preview MerchantShell
          </Link>
        </div>

        <Section id="brand" title="Brand">
          <Logo />
          <div className="grid grid-cols-5 gap-2">
            {SWATCHES.map(([name, cls]) => (
              <div key={name} className="space-y-1 text-center">
                <div className={`h-10 rounded-xl ring-1 ring-border ${cls}`} />
                <p className="truncate text-[10px] text-muted-foreground">{name}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-full">Utama</Button>
            <Button variant="secondary" className="rounded-full">Sekunder</Button>
            <Button variant="outline" className="rounded-full">Outline</Button>
            <Button className="rounded-full bg-deal text-deal-foreground hover:bg-deal/90">Promo</Button>
          </div>
        </Section>

        <Section id="harga" title="Harga & badge">
          <PriceTag original={20000} selling={8000} size="lg" />
          <PriceTag original={15000} selling={7500} />
          <PriceTag original={12000} selling={9000} size="sm" layout="stacked" />
          <div className="flex flex-wrap items-center gap-2">
            <DiscountBadge pct={30} />
            <DiscountBadge pct={50} />
            <DiscountBadge pct={70} size="lg" />
            <StockBadge available={9} />
            <StockBadge available={3} />
            <StockBadge available={0} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {soon && <CountdownBadge endIso={soon} />}
            {later && <CountdownBadge endIso={later} variant="solid" />}
            {past && <CountdownBadge endIso={past} />}
            {soon && <CountdownBadge endIso={soon} variant="plain" prefix="Ambil" />}
          </div>
          {soon && <CountdownHookDemo target={soon} />}
          <div className="flex flex-wrap items-center gap-2">
            <VerifiedBadge />
            <span className="inline-flex items-center gap-1 text-sm font-semibold">
              Warung Nasi Teh Euis <VerifiedBadge compact />
            </span>
            <Money value={123500} className="font-bold" />
            <Money value={2000} prefix="-" className="text-primary" />
          </div>
        </Section>

        <Section id="dampak" title="Dampak">
          <ImpactStat foodGrams={4200} co2Grams={10500} />
          <ImpactStat foodGrams={4200} co2Grams={10500} showTrees />
          <ImpactStat foodGrams={400} co2Grams={1000} variant="inline" />
          <div className="rounded-3xl bg-gradient-to-br from-[oklch(0.56_0.14_152)] to-[oklch(0.4_0.1_158)] p-3">
            <ImpactStat foodGrams={4200} co2Grams={10500} variant="hero" showTrees />
          </div>
        </Section>

        <Section id="filter" title="Filter & lokasi">
          <LocationPill />
          <p className="text-xs text-muted-foreground tabular-nums">
            Store: {loc.label} ({loc.source}) · {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)} · radius {loc.radius_m} m
          </p>
          <CategoryChips value={category} onChange={setCategory} />
        </Section>

        <Section id="keranjang" title="Keranjang & dialog">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="rounded-full"
              disabled={!now}
              onClick={() =>
                now && addToCart({ id: "mA", slug: "warung-a", name: "Warung Nasi Teh Euis" }, demoItem(now, "b1", "Nasi Rendang", 9000, 20000))
              }
            >
              + Warung A
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={!now}
              onClick={() =>
                now && addToCart({ id: "mB", slug: "warung-b", name: "Geprek Bateng" }, demoItem(now, "b2", "Ayam Geprek", 7000, 16000))
              }
            >
              + Warung B (beda mitra)
            </Button>
            <Button size="sm" variant="ghost" className="rounded-full" onClick={clearCart}>
              <Trash2Icon /> Kosongkan
            </Button>
            <Button size="sm" variant="secondary" className="rounded-full" onClick={() => setConfirmOpen(true)}>
              ConfirmDialog
            </Button>
          </div>
          <FloatingCartBar />
          {dialog}
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Batalkan pesanan?"
            description="Stok akan dikembalikan ke warung dan kamu bisa memesan ulang."
            destructive
            icon={<Trash2Icon className="size-7" />}
            confirmLabel="Ya, batalkan"
            onConfirm={() => setConfirmOpen(false)}
          />
        </Section>

        <Section id="status" title="Status">
          <EmptyState
            title="Belum ada surplus di sekitarmu"
            description="Coba perluas radius ke 5 km atau aktifkan notifikasi agar dikabari saat warung membuka surplus."
            action={<Button className="rounded-full">Perluas radius</Button>}
          />
          <ErrorState error={new ApiClientError("NETWORK_ERROR", "Tidak dapat terhubung ke server. Periksa koneksi internet.", 0)} onRetry={() => undefined} />
          <ErrorState compact message="Gagal memuat ulasan." onRetry={() => undefined} />
          <ListSkeleton count={2} />
          <ListSkeleton count={2} variant="row" />
          <ListSkeleton count={3} variant="tile" />
        </Section>

        <Section id="qr" title="QR">
          <QrCodeView value="SS1.demo-pickup-token.0000" caption={<b className="text-2xl tracking-widest text-foreground">SJ-4829</b>} />
        </Section>

        <Section id="peta" title="Peta surplus">
          <div className="h-80 overflow-hidden rounded-2xl ring-1 ring-border">
            <SurplusMap
              center={{ lat: HOME.lat, lng: HOME.lng }}
              radiusM={2000}
              markers={markers}
              selectedId={selected}
              onMarkerClick={setSelected}
              userLocation={{ lat: HOME.lat - 0.001, lng: HOME.lng + 0.001 }}
            />
          </div>
          <p className="text-xs text-muted-foreground">Dipilih: {markers.find((m) => m.id === selected)?.name ?? "—"}</p>
        </Section>

        <Section id="picker" title="Pilih lokasi warung">
          <LocationPickerMap value={pin} onChange={setPin} />
        </Section>

        <Section id="pwa" title="PWA">
          <InstallBanner forceVisible />
          <Button variant="outline" className="rounded-full">
            <ShareIcon /> Bagikan
          </Button>
        </Section>
      </div>
    </div>
  );
}
