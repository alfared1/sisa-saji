"use client";

/**
 * /profile — Akun: name & campus edit (PATCH /profile), appearance
 * (Terang / Gelap / Sistem, for guests too), notifications, shortcuts,
 * "Daftar jadi Mitra Warung", install app, logout.
 */
import { useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckIcon,
  ChevronRightIcon,
  CompassIcon,
  DownloadIcon,
  GraduationCapIcon,
  HeartIcon,
  LeafIcon,
  Loader2Icon,
  LogOutIcon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  ReceiptTextIcon,
  ShareIcon,
  SmartphoneIcon,
  StoreIcon,
  UserRoundIcon,
} from "lucide-react";
import { CampusPicker } from "@/components/common/campus-picker";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ThemeSwitcher } from "@/components/common/theme-switcher";
import { ShellHeader } from "@/components/shell/customer-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { useSession, useSetSessionUser } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import { campusIdByName } from "@/lib/campuses";
import { CAMPUSES, type CampusId } from "@/lib/constants";
import type { ProfileUpdateBody, SessionUser } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { useLocationStore } from "@/stores/location";
import { LoginCta, TabTitle } from "../bits";
import { PushOptIn } from "../impact/impact-screen";
import { badgeLabel } from "../lib/format";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function LinkRow({
  href,
  icon: Icon,
  label,
  hint,
  tint = "bg-muted text-foreground/80",
  onClick,
  trailing,
}: {
  href?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  tint?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const inner = (
    <>
      <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", tint)}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {trailing ?? <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />}
    </>
  );
  const cls =
    "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function InstallRow() {
  const { canInstall, showIOSHint, isStandalone, promptInstall } = useInstallPrompt();
  const [showHint, setShowHint] = useState(false);
  if (isStandalone) {
    return (
      <LinkRow
        icon={SmartphoneIcon}
        label="Aplikasi sudah terpasang"
        hint="Kamu memakai Sisa-Saji versi aplikasi"
        trailing={<CheckIcon className="size-5 text-primary" />}
      />
    );
  }
  return (
    <>
      <LinkRow
        icon={DownloadIcon}
        label="Pasang aplikasi"
        hint={canInstall ? "Buka lebih cepat dari layar utama, tiket tetap bisa offline" : "Tambahkan ke layar utama HP-mu"}
        onClick={async () => {
          if (canInstall) {
            const r = await promptInstall();
            if (r === "accepted") toast.success("Sisa-Saji sudah terpasang di perangkatmu");
          } else setShowHint((v) => !v);
        }}
      />
      {showHint && (
        <p className="mx-4 mb-3 flex items-start gap-2 rounded-2xl bg-muted p-3 text-xs leading-relaxed">
          <ShareIcon className="mt-0.5 size-4 shrink-0" />
          {showIOSHint
            ? "Di Safari, ketuk tombol Bagikan lalu pilih “Tambahkan ke Layar Utama”."
            : "Buka menu browser (⋮) lalu pilih “Instal aplikasi” atau “Tambahkan ke layar utama”."}
        </p>
      )}
    </>
  );
}

function ProfileEditor({ user, onDone }: { user: SessionUser; onDone: () => void }) {
  const setSessionUser = useSetSessionUser();
  const setCampus = useLocationStore((s) => s.setCampus);
  const [name, setName] = useState(user.full_name);
  const initialCampus = campusIdByName(user.campus_or_area);
  const [campus, setCampusId] = useState<CampusId | null>(initialCampus);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: ProfileUpdateBody) => api.patch<{ user: SessionUser }>("/profile", body),
    onSuccess: ({ user: u }) => {
      setSessionUser(u);
      const c = CAMPUSES.find((x) => x.id === campus);
      if (c && c.id !== initialCampus) setCampus(c.id);
      toast.success("Profil disimpan");
      onDone();
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : "Gagal menyimpan profil."),
  });

  return (
    <form
      className="space-y-4 border-t border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed.length < 2) {
          setError("Nama minimal 2 huruf.");
          return;
        }
        const c = CAMPUSES.find((x) => x.id === campus);
        save.mutate({
          full_name: trimmed,
          campus_or_area: c?.name ?? user.campus_or_area ?? null,
          ...(c ? { default_lat: c.lat, default_lng: c.lng } : {}),
        });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="profile-name" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Nama lengkap
        </label>
        <Input
          id="profile-name"
          value={name}
          maxLength={120}
          autoComplete="name"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className="h-12 rounded-2xl text-base"
          aria-invalid={error ? true : undefined}
        />
      </div>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Kampus / kota</legend>
        <div className="max-h-80 overflow-y-auto overscroll-contain rounded-2xl bg-muted/40 p-2 ring-1 ring-border">
          <CampusPicker value={campus} onSelect={setCampusId} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Pilihan ini juga dipakai sebagai titik pencarian default.</p>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-11 rounded-full" onClick={onDone} disabled={save.isPending}>
          Batal
        </Button>
        <Button type="submit" className="h-11 rounded-full font-bold" disabled={save.isPending}>
          {save.isPending && <Loader2Icon className="animate-spin" />} Simpan
        </Button>
      </div>
    </form>
  );
}

export function ProfileScreen() {
  const session = useSession();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const user = session.user;

  return (
    <>
      <ShellHeader>
        <TabTitle title="Akun" subtitle="Profil, notifikasi & pengaturan" />
      </ShellHeader>

      {/*
        lg+: narrow (896px) two-column settings layout: account (+ inline edit
        form), appearance and logout on the left, notifications + menu on the
        right. The right column spans all rows and the last row is 1fr, so the
        left rows keep their natural height. Phones keep the single column in
        DOM order (profile, notifications, menu, appearance, logout); the
        "Profil" label is desktop-only (display:none on phones).
      */}
      <div
        data-shell-width="narrow"
        className="flex flex-col gap-4 px-4 pt-4 pb-6 lg:grid lg:grid-cols-2 lg:grid-rows-[auto_auto_auto_auto_1fr] lg:items-start lg:gap-x-6 lg:gap-y-2 lg:pt-6"
      >
        <h2 className="hidden px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:col-start-1 lg:row-start-1 lg:block">
          Profil
        </h2>
        {session.isLoading ? (
          <Skeleton className="h-36 w-full rounded-3xl lg:col-start-1 lg:row-start-2" />
        ) : !user ? (
          <div className="rounded-3xl bg-card shadow-soft ring-1 ring-border lg:col-start-1 lg:row-start-2">
            <LoginCta
              title="Masuk ke Sisa-Saji"
              description="Simpan tiket pengambilan, lacak dampakmu, dan ikuti warung favorit."
              next="/profile"
              icon={<UserRoundIcon className="size-9 text-primary" />}
              className="py-10"
            />
          </div>
        ) : (
          <section className="overflow-hidden rounded-3xl bg-card shadow-soft ring-1 ring-border lg:col-start-1 lg:row-start-2">
            <div className="flex items-center gap-3 p-4">
              <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-lg font-extrabold text-primary-foreground">
                {initials(user.full_name) || "S"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-extrabold">{user.full_name}</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {user.phone_number ? <PhoneIcon className="size-3" /> : <MailIcon className="size-3" />}
                  {user.phone_number ?? user.email}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-primary">
                    <LeafIcon className="size-3" /> {badgeLabel(user.badge_tier)}
                  </span>
                  {user.campus_or_area && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
                      <GraduationCapIcon className="size-3" /> {user.campus_or_area}
                    </span>
                  )}
                </div>
              </div>
              {!editing && (
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="size-10 shrink-0 rounded-full"
                  onClick={() => setEditing(true)}
                  aria-label="Ubah profil"
                >
                  <PencilIcon className="size-4" />
                </Button>
              )}
            </div>
            {editing && <ProfileEditor user={user} onDone={() => setEditing(false)} />}
          </section>
        )}

        <div className="contents lg:col-start-2 lg:row-span-5 lg:row-start-1 lg:flex lg:flex-col lg:gap-4">
        {user && (
          <section aria-label="Notifikasi" className="space-y-2">
            <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Notifikasi</h2>
            <PushOptIn />
          </section>
        )}

        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Menu</h2>
          <div className="divide-y divide-border overflow-hidden rounded-3xl bg-card shadow-soft ring-1 ring-border">
            <LinkRow href="/orders" icon={ReceiptTextIcon} label="Pesanan saya" hint="Tiket pengambilan & riwayat" />
            <LinkRow href="/impact" icon={LeafIcon} label="Dampak & level" hint="kg pangan, CO₂e, uang dihemat" />
            <LinkRow href="/impact#fav-title" icon={HeartIcon} label="Warung favorit" hint="Pengingat surplus & perkiraan porsi sisa" />
            {user?.merchant_id ? (
              <LinkRow href="/merchant/dashboard" icon={StoreIcon} label="Dasbor Mitra Warung" hint="Kelola surplus warungmu" />
            ) : (
              <LinkRow
                href={user ? "/merchant/onboarding" : "/auth/login?role=MERCHANT"}
                icon={StoreIcon}
                label="Daftar jadi Mitra Warung"
                hint="Jual porsi surplus, kurangi makanan terbuang"
              />
            )}
            <LinkRow
              href="/tour"
              icon={CompassIcon}
              label="Tur aplikasi"
              hint="Cara pakai Sisa-Saji dalam 1 menit"
            />
            <InstallRow />
          </div>
        </section>
        </div>

        {/* Device setting, so guests get it too; it applies on tap (no save button). After
            Notifikasi and Menu on phones (a cosmetic choice should not push them down); on lg
            it sits in the left column under the profile card. */}
        <section aria-labelledby="tampilan-title" className="space-y-2 lg:col-start-1 lg:row-start-3 lg:mt-4">
          <h2 id="tampilan-title" className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Tampilan
          </h2>
          <div className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
            <ThemeSwitcher />
          </div>
        </section>

        {user && (
          <Button
            variant="ghost"
            className="h-12 rounded-full font-bold text-urgent hover:bg-urgent-soft hover:text-urgent lg:col-start-1 lg:row-start-4 lg:mt-2 lg:justify-self-start lg:px-6"
            onClick={() => setConfirmLogout(true)}
          >
            <LogOutIcon className="size-4" /> Keluar
          </Button>
        )}
        <p className="text-center text-[11px] text-muted-foreground lg:col-span-2 lg:row-start-6 lg:pt-6">Sisa-Saji · Selamatkan makanan, hemat uang</p>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        destructive
        icon={<LogOutIcon className="size-7" />}
        title="Keluar dari akun?"
        description="Tiket offline di perangkat ini juga akan dihapus."
        confirmLabel="Keluar"
        loading={session.isLoggingOut}
        onConfirm={async () => {
          // logout() also wipes offline tickets + the SW ticket/page caches.
          await session.logout();
          setConfirmLogout(false);
          toast("Kamu sudah keluar");
          router.replace("/welcome");
        }}
      />
    </>
  );
}
