"use client";

/**
 * Checkout building blocks: PickupOptionsCard (+ the "Titip Antar Kolektif" waiting list),
 * PickupTimeSlotSelector, BringOwnContainerToggle (+ LunchboxModal), VoucherSelectorSheet,
 * PaymentMethodPicker and PriceAndImpactBreakdown.
 */
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BikeIcon,
  CheckIcon,
  ChevronRightIcon,
  FootprintsIcon,
  HandPlatterIcon,
  LeafIcon,
  Loader2Icon,
  MapPinIcon,
  ReceiptTextIcon,
  RecycleIcon,
  TicketPercentIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { DemoLockNotice } from "@/components/common/demo-lock-notice";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDeliveryInterest } from "@/hooks/use-delivery-interest";
import { ApiClientError } from "@/lib/api/client";
import { COLLECTIVE_DELIVERY_FEE_DISPLAY_IDR, PAY_AT_WARUNG_HOLD_MINUTES } from "@/lib/constants";
import {
  CHECKOUT_PAYMENT_CHOICES,
  type CheckoutPaymentChoice,
  type PaymentMethod,
  type SessionUser,
  type Voucher,
} from "@/lib/contracts";
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
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className="size-4 text-primary" />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------ Pickup options ------------------------------ */

/** Radio dot for the custom radio rows (decorative; the row carries role="radio"). */
function RadioDot({ checked, muted = false }: { checked: boolean; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full ring-2",
        checked ? "ring-primary" : muted ? "ring-muted-foreground/30" : "ring-muted-foreground/50",
      )}
    >
      {checked && <span className="size-2.5 rounded-full bg-primary" />}
    </span>
  );
}

/**
 * How the order is collected. Self-pickup is the only way (docs/ARCHITECTURE.md, "Hanya ambil
 * sendiri"); "Titip Antar Kolektif" is shown as a disabled, not selectable option with
 * "Segera hadir" and a waiting list. Nothing here is sent with the checkout.
 */
export function PickupOptionsCard({
  merchant,
  userLocation,
  user,
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
  user: SessionUser | null;
}) {
  const walk = travelMinutes(merchant?.distance_m);
  const motor = travelMinutes(merchant?.distance_m, "motor");
  return (
    <CheckoutCard title="Cara ambil" icon={HandPlatterIcon}>
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
      </div>
      {merchant && (
        <div className="mt-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{merchant.name}</p>
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
          <Button asChild variant="outline" size="sm" className="h-9 shrink-0 rounded-full px-3 text-xs font-semibold">
            <a href={mapsDirectionsUrl(merchant.lat, merchant.lng)} target="_blank" rel="noreferrer">
              Rute
            </a>
          </Button>
        </div>
      )}

      <div role="radiogroup" aria-label="Cara ambil" className="mt-4 space-y-2">
        <div
          role="radio"
          aria-checked="true"
          tabIndex={0}
          className="flex items-center gap-3 rounded-2xl bg-brand-soft p-3 ring-2 ring-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <RadioDot checked />
          <span className="min-w-0 flex-1 text-sm font-semibold">Ambil sendiri ke warung</span>
          <span className="shrink-0 text-sm font-extrabold tabular-nums">Rp 0</span>
        </div>
        <div
          role="radio"
          aria-checked="false"
          aria-disabled="true"
          tabIndex={-1}
          className="flex items-start gap-3 rounded-2xl bg-muted/50 p-3 ring-1 ring-border"
        >
          <span className="mt-0.5">
            <RadioDot checked={false} muted />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-muted-foreground">Titip Antar Kolektif Kos/Asrama</span>
            <span className="mt-1 inline-flex rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:text-amber-100">
              Segera hadir
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">
            +{formatIdr(COLLECTIVE_DELIVERY_FEE_DISPLAY_IDR)}
          </span>
        </div>
      </div>

      <DeliveryInterestFooter user={user} />
    </CheckoutCard>
  );
}

/**
 * Waiting list under the pickup options: how many buyers want collective delivery, and
 * "Kabari saya" to add your kos or asrama (only the count is ever public). Demo accounts
 * are refused by the API, so their form is locked here.
 */
function DeliveryInterestFooter({ user }: { user: SessionUser | null }) {
  const [open, setOpen] = useState(false);
  const { data, register, cancel } = useDeliveryInterest({ userId: user?.id ?? null });
  const mine = data?.mine ?? null;
  const count = data?.count ?? null;
  const countText = count === null ? null : count >= 1 ? `${count} orang ingin fitur ini` : "Jadilah yang pertama";

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
      <p>Saat ini hanya ambil sendiri di warung.</p>
      {mine ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0">
            <span className="font-semibold text-foreground">Kamu sudah terdaftar ({mine.kos_name})</span>
            {countText && <span className="block">{countText}</span>}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-xl px-2 text-xs font-semibold text-urgent hover:bg-urgent-soft hover:text-urgent"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(undefined, {
                onSuccess: () => toast("Pendaftaran titip antar dibatalkan"),
                onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Gagal membatalkan."),
              })
            }
          >
            {cancel.isPending && <Loader2Icon className="size-3.5 animate-spin" aria-hidden />}
            Batalkan
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0">{countText}</p>
          {user && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl px-3 text-xs font-semibold"
              onClick={() => setOpen(true)}
            >
              Kabari saya
            </Button>
          )}
        </div>
      )}
      {user && (
        <DeliveryInterestSheet
          open={open}
          onOpenChange={setOpen}
          demo={user.is_demo}
          pending={register.isPending}
          onSubmit={(kos) =>
            register.mutate(
              { kos_name: kos },
              {
                onSuccess: () => {
                  setOpen(false);
                  toast.success("Oke, nanti kami kabari.");
                },
                onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Gagal mendaftar. Coba lagi."),
              },
            )
          }
        />
      )}
    </div>
  );
}

function DeliveryInterestSheet({
  open,
  onOpenChange,
  demo,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  demo: boolean;
  pending: boolean;
  onSubmit: (kosName: string) => void;
}) {
  const inputId = useId();
  const [kos, setKos] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent className="mx-auto max-w-md rounded-t-3xl">
        <ResponsiveSheetHeader className="text-left">
          <ResponsiveSheetTitle className="text-lg font-bold">Kabari saya saat titip antar hadir</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Titip antar kolektif belum tersedia. Kami mencatat kos atau asramamu untuk menghitung minat, dan namanya tidak
            ditampilkan ke orang lain.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <form
          className="space-y-4 px-4 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (demo || pending) return;
            const name = kos.trim().replace(/\s+/g, " ");
            if (name.length < 2) {
              setError("Tulis nama kos atau asrama, minimal 2 huruf.");
              return;
            }
            onSubmit(name);
          }}
        >
          {demo && <DemoLockNotice message="Akun demo tidak bisa mendaftar. Masuk dengan akunmu sendiri." />}
          <div className="space-y-1.5">
            <label htmlFor={inputId} className="text-sm font-semibold text-muted-foreground">
              Nama kos atau asrama
            </label>
            <Input
              id={inputId}
              value={kos}
              maxLength={60}
              placeholder="Contoh: Asrama Putra IPB"
              disabled={demo}
              onChange={(e) => {
                setKos(e.target.value);
                setError(null);
              }}
              className="h-12 rounded-xl text-base"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
            />
            {error && (
              <p id={`${inputId}-error`} role="alert" className="text-xs font-medium text-destructive">
                {error}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Rencana biaya titip antar {formatIdr(COLLECTIVE_DELIVERY_FEE_DISPLAY_IDR)} per pesanan. Belum ada yang ditagih.
          </p>
          <Button type="submit" className="h-12 w-full rounded-xl text-base font-semibold" disabled={demo || pending}>
            {pending && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
            Kabari saya
          </Button>
        </form>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

/* ------------------------------ Pickup time ------------------------------ */

export function PickupTimeSlotSelector({
  slots,
  value,
  onChange,
  deadlineLabel,
  loading,
  asapSub = "Langsung setelah bayar",
}: {
  slots: PickupSlot[];
  value: string | null;
  onChange: (iso: string | null) => void;
  deadlineLabel: string | null;
  loading: boolean;
  /** Sub-label of "Secepatnya" (a cash ticket says "Datang sebelum 20.45"). */
  asapSub?: string;
}) {
  const options: { key: string | null; label: string; sub?: string }[] = [
    { key: null, label: "Secepatnya", sub: asapSub },
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
        <p className="mt-2 text-xs text-muted-foreground">Batas ambil sudah dekat. Segera ambil setelah bayar.</p>
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
          <label htmlFor="own-container" className="block text-sm font-semibold">
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
            <DialogTitle className="text-lg font-bold">Terima kasih sudah bawa wadah sendiri</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Tunjukkan kotak bekal atau wadahmu ke warung saat mengambil pesanan. Pastikan bersih dan cukup untuk
              semua porsi.
            </DialogDescription>
          </DialogHeader>
          {voucherAvailable && (
            <div className="flex items-center gap-3 rounded-2xl bg-deal-soft p-3 text-left">
              <TicketPercentIcon className="size-5 shrink-0 text-deal" />
              <p className="text-xs leading-snug">
                Pakai voucher <b className="font-semibold">BAWABEKAL</b>: potongan{" "}
                <span className="whitespace-nowrap">Rp 1.500</span> (min. belanja{" "}
                <span className="whitespace-nowrap">Rp 8.000</span>).
              </p>
            </div>
          )}
          <div className="mt-1 grid grid-cols-1 gap-2">
            {voucherAvailable && (
              <Button
                className="h-11 rounded-xl font-semibold"
                onClick={() => {
                  onUseVoucher();
                  setOpen(false);
                }}
              >
                Pakai voucher BAWABEKAL
              </Button>
            )}
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => setOpen(false)}>
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
    // Same 44px icon tile as BringOwnContainerToggle above, so both rows' titles line up.
    <div className="flex items-center gap-3 rounded-3xl bg-card p-2 pl-4 shadow-soft ring-1 ring-border">
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-deal-soft text-deal">
        <TicketPercentIcon className="size-5" />
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="min-w-0 flex-1">
          {voucher ? (
            <>
              <span className="block text-sm font-semibold">{voucher.code}</span>
              <span className={cn("block truncate text-xs", ok?.eligible ? "text-primary" : "text-urgent")}>
                {ok?.eligible
                  ? `Hemat ${formatIdr(voucher.discount_idr)}`
                  : `Belanja ${formatIdr(ok?.shortfall_idr ?? 0)} lagi untuk memakai voucher ini`}
              </span>
            </>
          ) : (
            <>
              <span className="block text-sm font-semibold">Pakai voucher</span>
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
          <ResponsiveSheetDescription>Potongan ditanggung platform, warung tetap menerima penuh.</ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        {/* pt-1: room for the first card's ring / focus ring inside the scroller. */}
        <div className="min-h-0 space-y-2.5 overflow-y-auto px-4 pt-1 pb-6">
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
                  <span className="block text-sm font-semibold tracking-wide">{v.code}</span>
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

/**
 * Picker rows in CHECKOUT_PAYMENT_CHOICES order. E-wallet names keep their brand tint, each
 * ≥ 4.5:1 on the card and on the selected (brand-soft) row in both themes. "Paling populer"
 * is backed by the team's survey (QRIS 86%).
 */
const METHODS: Record<CheckoutPaymentChoice, { label: string; sub: string; chip?: string; tint: string }> = {
  QRIS: { label: "QRIS Instan", sub: "Scan dari e-wallet atau m-banking apa saja", chip: "Paling populer", tint: "text-foreground" },
  BAYAR_DI_WARUNG: {
    label: "Bayar Tunai di Warung",
    sub: `Komitmen ambil. Porsi ditahan ${PAY_AT_WARUNG_HOLD_MINUTES} menit, bayar saat ambil.`,
    tint: "text-foreground",
  },
  GOPAY: { label: "GoPay", sub: "Dibayar lewat kode QRIS", tint: "text-sky-700 dark:text-sky-400" },
  DANA: { label: "DANA", sub: "Dibayar lewat kode QRIS", tint: "text-blue-600 dark:text-blue-400" },
};

/**
 * Vertical radio list "Metode pembayaran" (arrow keys move the choice). `cashDisabledReason`
 * turns the cash row off with that reason (e.g. more than PAY_AT_WARUNG_MAX_PORTIONS portions).
 */
export function PaymentMethodPicker({
  value,
  onChange,
  cashDisabledReason,
}: {
  value: PaymentMethod;
  onChange: (m: CheckoutPaymentChoice) => void;
  cashDisabledReason?: string | null;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const keys = CHECKOUT_PAYMENT_CHOICES;
  const isDisabled = (k: CheckoutPaymentChoice) => k === "BAYAR_DI_WARUNG" && Boolean(cashDisabledReason);
  const checkedIndex = keys.findIndex((k) => k === value);
  const move = (from: number, delta: number) => {
    for (let step = 1; step <= keys.length; step++) {
      const next = (from + delta * step + keys.length) % keys.length;
      if (!isDisabled(keys[next])) {
        onChange(keys[next]);
        refs.current[next]?.focus();
        return;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label="Metode pembayaran" className="space-y-2">
      {keys.map((k, i) => {
        const m = METHODS[k];
        const active = value === k;
        const disabled = isDisabled(k);
        return (
          <button
            key={k}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            tabIndex={active || (checkedIndex === -1 && i === 0) ? 0 : -1}
            onClick={() => onChange(k)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "flex w-full items-start gap-3 rounded-2xl p-3 text-left ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed",
              active ? "bg-brand-soft ring-2 ring-primary" : "bg-card ring-border hover:bg-muted",
              disabled && "bg-muted/50 hover:bg-muted/50",
            )}
          >
            <span className="mt-0.5">
              <RadioDot checked={active} muted={disabled} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("text-sm font-semibold", disabled ? "text-muted-foreground" : m.tint)}>{m.label}</span>
                {m.chip && (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-strong ring-1 ring-primary/20">
                    {m.chip}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                {disabled && cashDisabledReason ? cashDisabledReason : m.sub}
              </span>
            </span>
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
  totalLabel = "Total bayar",
  children,
}: {
  p: PricePreview;
  voucherCode: string | null;
  /** "Bayar di warung saat ambil" for a cash ticket. */
  totalLabel?: string;
  /** Rendered at the bottom of the card (checkout uses it for the lg+ pay button). */
  children?: React.ReactNode;
}) {
  return (
    <CheckoutCard title="Rincian Pembayaran" icon={ReceiptTextIcon}>
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
          <dd className="font-semibold">{p.service_fee_idr > 0 ? <Money value={p.service_fee_idr} /> : "Gratis"}</dd>
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
          <dt className="font-semibold">{totalLabel}</dt>
          <dd className="text-xl font-bold">
            <Money value={p.total_idr} />
          </dd>
        </div>
      </dl>
      <div className="mt-3 rounded-2xl bg-brand-soft/80 p-3">
        <p className="text-sm font-semibold text-secondary-foreground">Kamu hemat {formatIdr(p.money_saved_idr)}</p>
        <p className="mt-1 text-xs font-semibold text-secondary-foreground/80">Total dampak pesanan</p>
        <ImpactLine foodGrams={p.food_saved_grams} className="mt-0.5 text-xs" />
      </div>
      {children}
    </CheckoutCard>
  );
}
