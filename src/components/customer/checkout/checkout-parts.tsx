"use client";

/**
 * Checkout building blocks: SelfPickupInfoCard, PickupTimeSlotSelector,
 * BringOwnContainerToggle (+ LunchboxModal), VoucherSelectorSheet,
 * PaymentMethodPicker and PriceAndImpactBreakdown.
 */
import { useState } from "react";
import {
  BikeIcon,
  CheckIcon,
  ChevronRightIcon,
  FootprintsIcon,
  HandPlatterIcon,
  LeafIcon,
  MapPinIcon,
  RecycleIcon,
  TicketPercentIcon,
  TriangleAlertIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { ImpactLine } from "@/components/common/impact-line";
import { Money } from "@/components/common/money";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetDescription,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/common/responsive-sheet";
import { SurplusMap } from "@/components/map/surplus-map";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { PaymentMethod, Voucher } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { voucherEligibility, type PricePreview } from "../lib/checkout-logic";
import { formatDistance, mapsDirectionsUrl, travelMinutes } from "../lib/format";
import type { PickupSlot } from "../lib/pickup-slots";

export function CheckoutCard({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          {Icon && <Icon className="size-4 text-primary" />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------ Self pickup ------------------------------ */

export function SelfPickupInfoCard({
  merchant,
  userLocation,
}: {
  merchant: {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    distance_m: number | null;
    max_discount_pct: number;
    total_available_stock: number;
    closes_at: string | null;
  } | null;
  userLocation: { lat: number; lng: number } | null;
}) {
  const walk = travelMinutes(merchant?.distance_m);
  const motor = travelMinutes(merchant?.distance_m, "motor");
  return (
    <CheckoutCard title="Ambil Sendiri di Warung" icon={HandPlatterIcon}>
      <div className="overflow-hidden rounded-2xl ring-1 ring-border">
        <div className="pointer-events-none h-32">
          {merchant ? (
            <SurplusMap
              center={{ lat: merchant.lat, lng: merchant.lng }}
              radiusM={350}
              markers={[
                {
                  id: merchant.id,
                  lat: merchant.lat,
                  lng: merchant.lng,
                  name: merchant.name,
                  discount_pct: merchant.max_discount_pct,
                  stock: merchant.total_available_stock,
                  closes_at: merchant.closes_at,
                },
              ]}
              selectedId={merchant.id}
              userLocation={userLocation}
              showRecenter={false}
              className="h-32"
            />
          ) : (
            <Skeleton className="h-32 w-full rounded-none" />
          )}
        </div>
        <div className="flex items-start gap-2 bg-deal-soft/70 px-3 py-2 text-xs font-semibold text-deal">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          Khusus Ambil Sendiri di Warung — tidak ada pengantaran.
        </div>
      </div>
      {merchant && (
        <div className="mt-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{merchant.name}</p>
            <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
              <MapPinIcon className="mt-px size-3.5 shrink-0" /> {merchant.address}
            </p>
            {merchant.distance_m !== null && (
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
                <span className="inline-flex items-center gap-1">
                  <FootprintsIcon className="size-3.5 text-primary" /> {walk} mnt jalan kaki
                </span>
                <span className="inline-flex items-center gap-1">
                  <BikeIcon className="size-3.5 text-primary" /> {motor} mnt motor
                </span>
                <span className="text-muted-foreground">{formatDistance(merchant.distance_m)}</span>
              </p>
            )}
          </div>
          <Button asChild variant="outline" size="sm" className="h-9 shrink-0 rounded-full px-3 text-xs font-bold">
            <a href={mapsDirectionsUrl(merchant.lat, merchant.lng)} target="_blank" rel="noreferrer">
              Rute
            </a>
          </Button>
        </div>
      )}
    </CheckoutCard>
  );
}

/* ------------------------------ Pickup time ------------------------------ */

export function PickupTimeSlotSelector({
  slots,
  value,
  onChange,
  deadlineLabel,
  loading,
}: {
  slots: PickupSlot[];
  value: string | null;
  onChange: (iso: string | null) => void;
  deadlineLabel: string | null;
  loading: boolean;
}) {
  const options: { key: string | null; label: string; sub?: string }[] = [
    { key: null, label: "Secepatnya", sub: "Langsung setelah bayar" },
    ...slots.map((s) => ({ key: s.iso, label: s.label, sub: "WIB" })),
  ];
  return (
    <CheckoutCard
      title="Waktu Pengambilan"
      icon={ZapIcon}
      action={deadlineLabel && <span className="text-[11px] font-semibold text-urgent">Batas {deadlineLabel} WIB</span>}
    >
      {loading ? (
        <Skeleton className="h-14 w-full rounded-2xl" />
      ) : (
        <div role="radiogroup" aria-label="Waktu pengambilan" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
          {options.map((o) => {
            const active = value === o.key;
            return (
              <button
                key={o.key ?? "asap"}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(o.key)}
                className={cn(
                  "flex min-h-14 shrink-0 flex-col items-center justify-center rounded-2xl px-4 text-center ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "bg-foreground text-background ring-foreground" : "bg-card ring-border hover:bg-muted",
                )}
              >
                <span className="text-sm font-extrabold tabular-nums">{o.label}</span>
                {o.sub && (
                  <span className={cn("text-[10px] font-medium", active ? "text-background/75" : "text-muted-foreground")}>
                    {o.sub}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {!loading && slots.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Batas ambil sudah dekat — segera ambil setelah bayar.</p>
      )}
    </CheckoutCard>
  );
}

/* --------------------------- Bring own container --------------------------- */

export function BringOwnContainerToggle({
  checked,
  onCheckedChange,
  onUseVoucher,
  voucherAvailable,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  onUseVoucher: () => void;
  voucherAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className={cn(
          "flex items-center gap-3 rounded-3xl p-4 shadow-soft ring-1 transition-colors",
          checked ? "bg-brand-soft ring-primary/30" : "bg-card ring-border",
        )}
      >
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <RecycleIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor="own-container" className="block text-sm font-bold">
            Bawa wadah sendiri
          </label>
          <p className="text-xs leading-snug text-muted-foreground">Kurangi sampah plastik sekali pakai.</p>
        </div>
        <Switch
          id="own-container"
          checked={checked}
          onCheckedChange={(v) => {
            onCheckedChange(v);
            if (v) setOpen(true);
          }}
          aria-label="Bawa wadah sendiri"
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="max-w-[calc(100%-2rem)] rounded-3xl p-6 sm:max-w-sm">
          <DialogHeader className="items-center text-center sm:text-center">
            <span className="mb-1 inline-flex size-16 items-center justify-center rounded-3xl bg-brand-soft text-primary">
              <LeafIcon className="size-8" />
            </span>
            <DialogTitle className="text-lg font-bold">Terima kasih sudah bawa wadah!</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Tunjukkan kotak bekal atau wadahmu ke warung saat mengambil pesanan. Pastikan bersih dan cukup untuk
              semua porsi.
            </DialogDescription>
          </DialogHeader>
          {voucherAvailable && (
            <div className="flex items-center gap-3 rounded-2xl bg-deal-soft p-3 text-left">
              <TicketPercentIcon className="size-5 shrink-0 text-deal" />
              <p className="text-xs leading-snug">
                Pakai voucher <b className="font-extrabold">BAWABEKAL</b> — potongan Rp 1.500 (min. belanja Rp 8.000).
              </p>
            </div>
          )}
          <div className="mt-1 grid grid-cols-1 gap-2">
            {voucherAvailable && (
              <Button
                className="h-11 rounded-full font-bold"
                onClick={() => {
                  onUseVoucher();
                  setOpen(false);
                }}
              >
                Pakai voucher BAWABEKAL
              </Button>
            )}
            <Button variant="outline" className="h-11 rounded-full" onClick={() => setOpen(false)}>
              Oke, mengerti
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* -------------------------------- Vouchers -------------------------------- */

export function VoucherRow({
  voucher,
  subtotal,
  onOpen,
  onClear,
}: {
  voucher: Voucher | null;
  subtotal: number;
  onOpen: () => void;
  onClear: () => void;
}) {
  const ok = voucher ? voucherEligibility(voucher, subtotal) : null;
  return (
    <div className="flex items-center gap-2 rounded-3xl bg-card p-2 pl-4 shadow-soft ring-1 ring-border">
      <TicketPercentIcon className="size-5 shrink-0 text-deal" />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="min-w-0 flex-1">
          {voucher ? (
            <>
              <span className="block text-sm font-extrabold">{voucher.code}</span>
              <span className={cn("block truncate text-xs", ok?.eligible ? "text-primary" : "text-urgent")}>
                {ok?.eligible
                  ? `Hemat ${formatIdr(voucher.discount_idr)}`
                  : `Belanja ${formatIdr(ok?.shortfall_idr ?? 0)} lagi untuk memakai voucher ini`}
              </span>
            </>
          ) : (
            <>
              <span className="block text-sm font-bold">Pakai voucher</span>
              <span className="block text-xs text-muted-foreground">Lihat potongan yang tersedia</span>
            </>
          )}
        </span>
        {!voucher && <ChevronRightIcon className="size-5 text-muted-foreground" />}
      </button>
      {voucher && (
        <Button variant="ghost" size="icon-lg" className="size-10 rounded-full" onClick={onClear} aria-label="Lepas voucher">
          <XIcon className="size-4" />
        </Button>
      )}
    </div>
  );
}

export function VoucherSelectorSheet({
  open,
  onOpenChange,
  vouchers,
  loading,
  subtotal,
  selected,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vouchers: Voucher[];
  loading: boolean;
  subtotal: number;
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  return (
    // Phones: bottom drawer. lg+: centred dialog.
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent className="mx-auto max-w-md rounded-t-3xl">
        <ResponsiveSheetHeader className="text-left">
          <ResponsiveSheetTitle className="text-lg font-bold">Voucher Sisa-Saji</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>Potongan ditanggung platform — warung tetap menerima penuh.</ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <div className="min-h-0 space-y-2.5 overflow-y-auto px-4 pb-6">
          {loading &&
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
          {vouchers.map((v) => {
            const e = voucherEligibility(v, subtotal);
            const active = selected === v.code;
            return (
              <button
                key={v.code}
                type="button"
                disabled={!e.eligible}
                onClick={() => {
                  onSelect(active ? null : v.code);
                  onOpenChange(false);
                }}
                className={cn(
                  "relative flex w-full items-stretch overflow-hidden rounded-2xl text-left ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "bg-brand-soft ring-primary/50" : "bg-card ring-border hover:bg-muted",
                  !e.eligible && "opacity-60",
                )}
              >
                <span className="flex w-20 shrink-0 flex-col items-center justify-center border-r border-dashed border-border bg-deal-soft px-2 text-deal">
                  <span className="text-[10px] font-semibold">Hemat</span>
                  <span className="text-sm font-extrabold tabular-nums">{(v.discount_idr / 1000).toLocaleString("id-ID")}rb</span>
                </span>
                <span className="min-w-0 flex-1 p-3">
                  <span className="block text-sm font-extrabold tracking-wide">{v.code}</span>
                  <span className="block text-xs text-muted-foreground">{v.title}</span>
                  <span className={cn("mt-1 block text-[11px] font-semibold", e.eligible ? "text-primary" : "text-urgent")}>
                    {e.eligible ? "Bisa dipakai" : `Kurang ${formatIdr(e.shortfall_idr)} lagi`}
                  </span>
                </span>
                {active && <CheckIcon className="mr-3 size-5 self-center text-primary" />}
              </button>
            );
          })}
        </div>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

/* ----------------------------- Payment method ----------------------------- */

const METHODS: { key: PaymentMethod; label: string; tint: string }[] = [
  { key: "QRIS", label: "QRIS", tint: "text-foreground" },
  { key: "GOPAY", label: "GoPay", tint: "text-sky-600" },
  { key: "OVO", label: "OVO", tint: "text-violet-600" },
  { key: "DANA", label: "DANA", tint: "text-blue-600" },
];

export function PaymentMethodPicker({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <div role="radiogroup" aria-label="Metode pembayaran" className="grid grid-cols-4 gap-2">
      {METHODS.map((m) => {
        const active = value === m.key;
        return (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m.key)}
            className={cn(
              "flex h-12 items-center justify-center rounded-2xl text-sm font-extrabold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "bg-brand-soft ring-2 ring-primary" : "bg-card ring-border hover:bg-muted",
              m.tint,
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------- Price & impact --------------------------- */

export function PriceAndImpactBreakdown({
  p,
  voucherCode,
  children,
}: {
  p: PricePreview;
  voucherCode: string | null;
  /** Rendered at the bottom of the card (checkout uses it for the lg+ pay button). */
  children?: React.ReactNode;
}) {
  return (
    <CheckoutCard title="Rincian Pembayaran">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Harga normal</dt>
          <dd className="text-muted-foreground line-through decoration-urgent/50">
            <Money value={p.subtotal_original_idr} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Subtotal Harga Pemulihan</dt>
          <dd className="font-semibold">
            <Money value={p.subtotal_recovery_idr} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Biaya layanan</dt>
          <dd className="font-semibold">
            <Money value={p.service_fee_idr} />
          </dd>
        </div>
        {p.voucher_discount_idr > 0 && (
          <div className="flex justify-between gap-2 text-primary">
            <dt>Voucher {voucherCode}</dt>
            <dd className="font-semibold">
              <Money value={p.voucher_discount_idr} prefix="-" />
            </dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2 border-t border-dashed border-border pt-3">
          <dt className="font-bold">Total bayar</dt>
          <dd className="text-xl font-extrabold">
            <Money value={p.total_idr} />
          </dd>
        </div>
      </dl>
      <div className="mt-3 rounded-2xl bg-brand-soft/80 p-3">
        <p className="text-sm font-extrabold text-secondary-foreground">Kamu hemat {formatIdr(p.money_saved_idr)}</p>
        <p className="mt-1 text-[11px] font-bold tracking-wide text-secondary-foreground/80 uppercase">Total dampak pesanan</p>
        <ImpactLine foodGrams={p.food_saved_grams} className="mt-0.5 text-xs" />
      </div>
      {children}
    </CheckoutCard>
  );
}
