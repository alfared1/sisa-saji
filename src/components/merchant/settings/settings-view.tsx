"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ClockIcon, CrownIcon, ExternalLinkIcon, LandmarkIcon, Loader2Icon, LogOutIcon, MapPinIcon, SaveIcon, StoreIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/error-state";
import { VerifiedBadge } from "@/components/common/verified-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/hooks/use-session";
import { MerchantOnboardingBody, type MerchantProfile } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useMerchantMe, useUpdateMerchant } from "../lib/queries";
import { ZOD_ID_OPTIONS } from "../lib/zod-id";
import {
  BankSection,
  HoursSection,
  LocationSection,
  ProfileSection,
  profilePayload,
  profileToFormValues,
  type ProfileInput,
  type ProfileOutput,
} from "../profile/profile-fields";
import { MerchantPage, MerchantPageHeader, SectionCard } from "../ui";

function SettingsForm({ merchant }: { merchant: MerchantProfile }) {
  const update = useUpdateMerchant();
  const form = useForm<ProfileInput, unknown, ProfileOutput>({
    resolver: zodResolver(MerchantOnboardingBody, ZOD_ID_OPTIONS),
    defaultValues: profileToFormValues(merchant),
    mode: "onTouched",
  });
  const dirty = form.formState.isDirty;

  const onSubmit = form.handleSubmit(
    (values) =>
      update.mutate(profilePayload(values), {
        onSuccess: (res) => {
          form.reset(profileToFormValues(res.merchant));
          toast.success("Profil warung disimpan");
        },
      }),
    () => toast.error("Periksa lagi isian yang ditandai merah."),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 lg:space-y-6">
      <SectionCard title="Profil warung" icon={StoreIcon}>
        <ProfileSection form={form} idPrefix="set" />
      </SectionCard>
      <SectionCard title="Lokasi" icon={MapPinIcon}>
        <LocationSection form={form} idPrefix="set" />
      </SectionCard>
      <SectionCard title="Jam operasional" icon={ClockIcon}>
        <HoursSection form={form} idPrefix="set" />
      </SectionCard>
      <SectionCard title="Pencairan dana" icon={LandmarkIcon} description="Nomor rekening tidak ditampilkan ulang demi keamanan.">
        <BankSection form={form} idPrefix="set" savedNumberMasked={merchant.bank_account_number_masked} />
      </SectionCard>

      <div
        className={cn(
          "sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-2xl bg-card/95 p-3 shadow-float ring-1 ring-border backdrop-blur transition-opacity lg:bottom-6",
          !dirty && !update.isPending && "pointer-events-none opacity-0",
        )}
        aria-hidden={!dirty && !update.isPending}
      >
        <span className="pl-1 text-sm font-semibold">
          <span className="sm:hidden">Belum disimpan</span>
          <span className="hidden sm:inline">Ada perubahan belum disimpan</span>
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="h-11 rounded-full" onClick={() => form.reset()} disabled={update.isPending} tabIndex={dirty ? 0 : -1}>
            Batal
          </Button>
          <Button type="submit" className="h-11 rounded-full px-5 font-bold" disabled={update.isPending} tabIndex={dirty ? 0 : -1}>
            {update.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}

/** /merchant/settings — edit profile, location, hours, bank; open/close; logout. */
export function MerchantSettingsView() {
  const me = useMerchantMe();
  const update = useUpdateMerchant();
  const { user, logout, isLoggingOut } = useSession();
  const router = useRouter();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const m = me.data?.merchant;

  return (
    <MerchantPage>
      <MerchantPageHeader title="Pengaturan warung" backHref="/merchant/dashboard" subtitle={user ? `Masuk sebagai ${user.full_name} · ${user.phone_number ?? user.email ?? ""}` : undefined} />

      {me.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-96 rounded-3xl" />
        </div>
      ) : me.isError || !m ? (
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
          <div className="min-w-0">
            <SettingsForm key={m.id} merchant={m} />
          </div>
          <aside className="space-y-4 lg:sticky lg:top-6">
            <section className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border sm:p-5" aria-label="Status warung">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-bold">Warung {m.is_open ? "buka" : "tutup"}</span>
                  <span className="block text-xs text-muted-foreground">{m.is_open ? "Surplus tampil di aplikasi pembeli." : "Surplus disembunyikan dari pembeli."}</span>
                </span>
                <Switch checked={m.is_open} onCheckedChange={(v) => update.mutate({ is_open: v }, { onSuccess: () => toast.success(v ? "Warung dibuka" : "Warung ditutup") })} aria-label="Buka atau tutup warung" />
              </label>
            </section>

            <section className="space-y-3 rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border sm:p-5" aria-label="Langganan">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">Paket</span>
                {m.merchant_verified ? <VerifiedBadge /> : <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">Reguler</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                Saldo warung <b className="text-foreground tabular-nums">{formatIdr(m.wallet_balance_idr)}</b> · Rating {m.rating_avg.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ({m.total_reviews} ulasan)
              </p>
              <Link href="/merchant/analytics#premium" className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-deal-soft text-sm font-bold text-deal">
                <CrownIcon className="size-4" /> {m.subscription_tier === "PREMIUM" ? "Kelola Premium" : "Upgrade ke Premium"}
              </Link>
              <Link href={`/warung/${m.slug}`} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-card text-sm font-semibold ring-1 ring-border hover:bg-muted">
                <ExternalLinkIcon className="size-4" /> Lihat halaman warung
              </Link>
            </section>

            <Button variant="outline" className="h-12 w-full rounded-full border-urgent/30 text-urgent hover:bg-urgent-soft hover:text-urgent" onClick={() => setConfirmLogout(true)}>
              <LogOutIcon /> Keluar
            </Button>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        destructive
        icon={<LogOutIcon className="size-7" />}
        title="Keluar dari akun mitra?"
        description="Kamu perlu kode OTP lagi untuk masuk."
        confirmLabel="Keluar"
        loading={isLoggingOut}
        onConfirm={async () => {
          await logout();
          router.replace("/welcome");
        }}
      />
    </MerchantPage>
  );
}
