"use client";

/**
 * /merchant/lainnya — the phone's fifth tab: pages opened less often than the evening's work.
 * Each row carries its key number (saldo, rating) so the owner sees when it is worth opening.
 * Switching to buyer mode and logging out sit apart from the warung pages.
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BarChart3Icon,
  ChevronRightIcon,
  LogOutIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  SettingsIcon,
  ShoppingBagIcon,
  StoreIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { LogoutConfirm } from "@/components/shell/merchant-shell";
import { formatRating } from "@/components/customer/lib/format";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useMerchantMe } from "../lib/queries";
import { MerchantPage, MerchantPageHeader } from "../ui";

function Row({
  href,
  icon: Icon,
  label,
  hint,
  value,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  value?: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-16 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{label}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        {value !== undefined && <span className="shrink-0 text-sm font-bold tabular-nums">{value}</span>}
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

export function MerchantMoreView() {
  const me = useMerchantMe();
  const m = me.data?.merchant;
  const [confirmLogout, setConfirmLogout] = useState(false);
  const loading = (w: string) => <span className={cn("inline-block h-4 animate-pulse rounded bg-muted", w)} aria-label="Memuat" />;

  return (
    <MerchantPage className="mx-auto max-w-2xl space-y-4">
      <MerchantPageHeader title="Lainnya" subtitle="Saldo, ulasan, analitik, dan pengaturan warung." />

      <Group label="Warung">
        <Row href="/merchant/surplus/new" icon={MegaphoneIcon} label="Publikasi surplus" hint="Pasang porsi sisa malam ini" />
        <Row
          href="/merchant/saldo"
          icon={WalletIcon}
          label="Saldo"
          hint="Uang dari pesanan online yang sudah selesai"
          value={m ? <span className="text-deal">{formatIdr(m.wallet_balance_idr)}</span> : loading("w-20")}
        />
        <Row
          href="/merchant/ulasan"
          icon={MessageSquareTextIcon}
          label="Ulasan"
          hint={m && m.total_reviews > 0 ? `${m.total_reviews} ulasan pembeli` : "Belum ada ulasan"}
          value={m ? (m.total_reviews > 0 ? `★ ${formatRating(m.rating_avg)}` : undefined) : loading("w-10")}
        />
        <Row href="/merchant/analytics" icon={BarChart3Icon} label="Analitik" hint="Terjual, tersisa, dan perkiraan 7 hari" />
        <Row href="/merchant/settings" icon={SettingsIcon} label="Pengaturan" hint="Profil, jam buka, rekening, kasir, bunyi" />
        {m && <Row href={`/warung/${m.slug}`} icon={StoreIcon} label="Lihat halaman warung" hint="Seperti yang dilihat pembeli" />}
      </Group>

      <Group label="Akun">
        <Row href="/discover" icon={ShoppingBagIcon} label="Ke mode pembeli" hint="Cari porsi surplus di warung lain" />
        <li>
          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-[15px] font-semibold text-urgent outline-none hover:bg-urgent-soft focus-visible:bg-urgent-soft focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <LogOutIcon className="size-5 shrink-0" aria-hidden />
            Keluar
          </button>
        </li>
      </Group>
      <LogoutConfirm open={confirmLogout} onOpenChange={setConfirmLogout} />
    </MerchantPage>
  );
}
