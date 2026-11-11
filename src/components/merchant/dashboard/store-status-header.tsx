"use client";

import Link from "next/link";
import { ExternalLinkIcon, SettingsIcon, StoreIcon, WalletIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { VerifiedBadge } from "@/components/common/verified-badge";
import type { EventSourceStatus } from "@/hooks/use-event-source";
import type { MerchantProfile } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useUpdateMerchant } from "../lib/queries";

export function greetingFor(hourWib: number): string {
  if (hourWib < 11) return "Selamat pagi";
  if (hourWib < 15) return "Selamat siang";
  if (hourWib < 18) return "Selamat sore";
  return "Selamat malam";
}

export function LiveDot({ status }: { status: EventSourceStatus }) {
  const live = status === "open";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] leading-none font-bold",
        live ? "bg-success-soft text-primary" : "bg-muted text-muted-foreground",
      )}
      title={live ? "Pembaruan real-time aktif" : "Menyambungkan pembaruan real-time…"}
    >
      <span className={cn("size-1.5 rounded-full", live ? "bg-primary" : "bg-muted-foreground")} aria-hidden />
      {live ? "Live" : "Menyambung…"}
    </span>
  );
}

/** Blueprint StoreStatusHeader: Buka/Tutup switch, verified badge, wallet. */
export function StoreStatusHeader({
  merchant,
  ownerName,
  greeting,
  liveStatus,
}: {
  merchant: MerchantProfile;
  ownerName: string;
  greeting: string;
  liveStatus: EventSourceStatus;
}) {
  const update = useUpdateMerchant();
  const isOpen = merchant.is_open;
  const firstName = ownerName.split(/\s+/)[0] ?? ownerName;

  return (
    <section className="relative overflow-hidden rounded-3xl bg-card shadow-card ring-1 ring-border" aria-label="Status warung">
      <div className="relative flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3 lg:flex-1">
          <span className="hidden size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft sm:inline-flex">
            <StoreIcon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground">
              {greeting}, {firstName}
            </p>
            <h1 className="line-clamp-2 text-xl leading-tight font-extrabold tracking-tight break-words sm:text-2xl">{merchant.merchant_name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {merchant.merchant_verified ? (
                <VerifiedBadge />
              ) : (
                <Link
                  href="/merchant/analytics#premium"
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs leading-none font-semibold text-muted-foreground hover:text-foreground"
                >
                  Belum terverifikasi · Upgrade
                </Link>
              )}
              <LiveDot status={liveStatus} />
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5 lg:hidden">
            <Link
              href="/merchant/settings"
              aria-label="Pengaturan warung"
              title="Pengaturan warung"
              className="inline-flex size-11 items-center justify-center rounded-2xl bg-card ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <SettingsIcon className="size-5" />
            </Link>
            <Link
              href={`/warung/${merchant.slug}`}
              aria-label="Lihat halaman warung (tampilan pembeli)"
              title="Lihat halaman warung"
              className="inline-flex size-11 items-center justify-center rounded-2xl bg-card ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ExternalLinkIcon className="size-5" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:flex lg:items-stretch">
          <label
            className={cn(
              "flex min-h-16 cursor-pointer items-center justify-between gap-2 rounded-2xl px-3.5 py-2 ring-1 transition-colors lg:min-w-48",
              isOpen ? "bg-success-soft ring-primary/25" : "bg-muted ring-border",
            )}
          >
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-muted-foreground">Status</span>
              <span className={cn("block text-lg leading-tight font-extrabold", isOpen ? "text-primary" : "text-foreground/70")}>
                {isOpen ? "Buka" : "Tutup"}
              </span>
            </span>
            <Switch
              checked={isOpen}
              disabled={update.isPending}
              onCheckedChange={(v) => update.mutate({ is_open: v })}
              aria-label={isOpen ? "Tutup warung" : "Buka warung"}
              className="mr-1 scale-125"
            />
          </label>
          {/* Icon on the label line, so the amount gets the full tile width ("Rp 2.637.5…" was cut on phones). */}
          <div className="flex min-h-16 min-w-0 flex-col justify-center rounded-2xl bg-surface px-3.5 py-2 ring-1 ring-border lg:min-w-48">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <WalletIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
              Saldo warung
            </span>
            <span className="block truncate text-base leading-tight font-extrabold tabular-nums sm:text-lg">{formatIdr(merchant.wallet_balance_idr)}</span>
          </div>
          <div className="hidden lg:flex lg:items-center"><div className="flex shrink-0 gap-1.5">
            <Link
              href="/merchant/settings"
              aria-label="Pengaturan warung"
              title="Pengaturan warung"
              className="inline-flex size-11 items-center justify-center rounded-2xl bg-card ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <SettingsIcon className="size-5" />
            </Link>
            <Link
              href={`/warung/${merchant.slug}`}
              aria-label="Lihat halaman warung (tampilan pembeli)"
              title="Lihat halaman warung"
              className="inline-flex size-11 items-center justify-center rounded-2xl bg-card ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ExternalLinkIcon className="size-5" />
            </Link>
          </div></div>
        </div>
      </div>
      {!isOpen && (
        <p className="relative border-t border-border bg-warning-soft/70 px-4 py-2.5 text-xs font-medium text-amber-800 sm:px-5 dark:text-amber-200">
          Warung sedang tutup. Surplus tidak tampil di aplikasi pembeli sampai kamu buka lagi.
        </p>
      )}
    </section>
  );
}
