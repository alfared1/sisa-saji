"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ClockIcon, LandmarkIcon, MapPinIcon, StoreIcon, UtensilsIcon } from "lucide-react";
import { errorMessage } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { SESSION_QUERY_KEY, useSession } from "@/hooks/use-session";
import { api } from "@/lib/api/client";
import { MerchantOnboardingBody, type MenuCreateBody, type MenuView, type MerchantMeResponse } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { stripEmpty } from "../lib/logic";
import { MERCHANT_ME_QUERY_KEY, merchantKeys } from "../lib/queries";
import { ZOD_ID_OPTIONS } from "../lib/zod-id";
import { MenuForm, type MenuFormOutput } from "../menus/menu-form";
import {
  BankSection,
  HoursSection,
  LocationSection,
  PROFILE_STEP_FIELDS,
  ProfileSection,
  profilePayload,
  type ProfileInput,
  type ProfileOutput,
} from "../profile/profile-fields";

const STEPS = [
  { key: "profile", label: "Profil", title: "Kenalkan warungmu", subtitle: "Nama dan kontak yang dilihat mahasiswa.", icon: StoreIcon },
  { key: "location", label: "Lokasi", title: "Di mana warungmu?", subtitle: "Geser pin tepat di depan warung agar pembeli mudah menemukan.", icon: MapPinIcon },
  { key: "hours", label: "Jam", title: "Jam operasional", subtitle: "Jam tutup jadi batas ambil default saat publikasi surplus.", icon: ClockIcon },
  { key: "bank", label: "Pencairan", title: "Pencairan dana", subtitle: "Opsional — bisa dilengkapi nanti di Pengaturan.", icon: LandmarkIcon },
  { key: "menu", label: "Menu", title: "Menu pertama", subtitle: "Menu yang paling sering tersisa. Harga minimum melindungi modalmu.", icon: UtensilsIcon },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

function Progress({ step }: { step: number }) {
  return (
    <div>
      <ol className="flex gap-1.5" aria-label="Langkah pendaftaran">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex-1" aria-current={i === step ? "step" : undefined}>
            <span className={cn("block h-1.5 rounded-full transition-colors duration-300", i <= step ? "bg-primary" : "bg-border")} />
            <span className={cn("mt-1.5 hidden text-[11px] font-semibold sm:block", i === step ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs font-semibold text-muted-foreground sm:hidden">
        Langkah {step + 1} dari {STEPS.length} · {STEPS[step].label}
      </p>
    </div>
  );
}

/** /merchant/onboarding — 5-step wizard → POST /merchant/onboarding → POST /merchant/menus. */
export function OnboardingWizard() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useSession();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [created, setCreated] = useState<MerchantMeResponse | null>(null);

  const form = useForm<ProfileInput, unknown, ProfileOutput>({
    resolver: zodResolver(MerchantOnboardingBody, ZOD_ID_OPTIONS),
    mode: "onTouched",
    defaultValues: {
      merchant_name: "",
      merchant_category: "MAKANAN_BERAT",
      description: "",
      address: "",
      whatsapp_number: user?.phone_number ?? "",
      operational_open_time: "09:00",
      operational_close_time: "22:00",
      default_surplus_start_time: "20:00",
      bank_code: "",
      bank_account_number: "",
      bank_account_holder: "",
    },
  });

  const finish = useMutation({
    mutationFn: async ({ profile, menu }: { profile: ProfileOutput; menu: MenuFormOutput | null }) => {
      const me = created ?? (await api.post<MerchantMeResponse>("/merchant/onboarding", profilePayload(profile)));
      if (!created) setCreated(me);
      let firstMenu: MenuView | null = null;
      if (menu) firstMenu = (await api.post<{ menu: MenuView }>("/merchant/menus", stripEmpty(menu) as MenuCreateBody)).menu;
      return { me, firstMenu };
    },
    onSuccess: async ({ me, firstMenu }) => {
      qc.setQueryData<MerchantMeResponse>(MERCHANT_ME_QUERY_KEY, firstMenu ? { ...me, menus: [...me.menus, firstMenu] } : me);
      void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
      toast.success(`${me.merchant.merchant_name} siap menerima pembeli!`, {
        description: firstMenu ? "Publikasikan surplus pertamamu malam ini." : "Tambahkan menu kapan saja di halaman Menu.",
      });
      await qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      router.replace("/merchant/dashboard");
    },
    onError: (err) => toast.error(errorMessage(err, "Pendaftaran gagal. Coba lagi.")),
  });

  const current = STEPS[step];
  const go = (to: number) => {
    setDirection(to > step ? 1 : -1);
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const next = async () => {
    const key = current.key as Exclude<StepKey, "menu">;
    const ok = await form.trigger([...PROFILE_STEP_FIELDS[key]], { shouldFocus: true });
    if (ok) go(step + 1);
  };

  const submitWith = (menu: MenuFormOutput | null) =>
    form.handleSubmit(
      (profile) => finish.mutate({ profile, menu }),
      () => {
        toast.error("Ada data warung yang belum lengkap.");
        go(0);
      },
    )();

  return (
    <div className="pt-2">
      <Progress step={step} />

      <div className="mt-6 flex items-start gap-3">
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft">
          <current.icon className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight">{current.title}</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{current.subtitle}</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-clip">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={current.key}
            custom={direction}
            initial={{ opacity: 0, x: direction * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -24 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {current.key === "menu" ? (
              <div className="rounded-3xl bg-card/70 p-4 ring-1 ring-border sm:p-5">
                <MenuForm
                  idPrefix="onb-menu"
                  pending={finish.isPending}
                  submitLabel={
                    <>
                      <CheckIcon /> Selesai & buka dasbor
                    </>
                  }
                  onSubmit={(menu) => submitWith(menu)}
                  secondary={
                    <Button type="button" variant="ghost" className="h-12 rounded-full px-5" onClick={() => go(step - 1)} disabled={finish.isPending}>
                      <ArrowLeftIcon /> Kembali
                    </Button>
                  }
                />
                <button
                  type="button"
                  onClick={() => submitWith(null)}
                  disabled={finish.isPending}
                  className="mt-3 w-full text-center text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Lewati dulu, tambah menu nanti
                </button>
              </div>
            ) : (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void next();
                }}
              >
                {current.key === "profile" && <ProfileSection form={form} idPrefix="onb" />}
                {current.key === "location" && <LocationSection form={form} idPrefix="onb" />}
                {current.key === "hours" && <HoursSection form={form} idPrefix="onb" />}
                {current.key === "bank" && (
                  <div className="space-y-4">
                    <BankSection form={form} idPrefix="onb" />
                    <p className="rounded-2xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                      Hasil penjualan masuk ke saldo warung setiap pesanan selesai diambil, lalu dicairkan ke rekening ini.
                    </p>
                  </div>
                )}

                <div className="sticky bottom-0 -mx-4 mt-8 flex gap-2 border-t border-border/60 bg-background/90 px-4 py-3 backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
                  {step > 0 && (
                    <Button type="button" variant="outline" className="h-12 rounded-full px-5" onClick={() => go(step - 1)}>
                      <ArrowLeftIcon /> Kembali
                    </Button>
                  )}
                  {current.key === "bank" && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-12 rounded-full px-4"
                      onClick={() => {
                        form.setValue("bank_code", "");
                        form.setValue("bank_account_number", "");
                        form.setValue("bank_account_holder", "");
                        go(step + 1);
                      }}
                    >
                      Lewati
                    </Button>
                  )}
                  <Button type="submit" className="h-12 flex-1 rounded-full text-base font-bold">
                    Lanjut <ArrowRightIcon />
                  </Button>
                </div>
              </form>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
