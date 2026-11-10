"use client";

import { useId } from "react";
import { Controller, useWatch, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { MessageCircleIcon } from "lucide-react";
import { CATEGORY_ICONS } from "@/components/common/category-chips";
import { LocationPickerMap } from "@/components/map/location-picker-map";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MENU_CATEGORIES, MENU_CATEGORY_LABELS, MerchantOnboardingBody, type MerchantProfile } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { sanitizePhone, stripEmpty } from "../lib/logic";
import { FieldError } from "../ui";

export type ProfileInput = z.input<typeof MerchantOnboardingBody>;
export type ProfileOutput = z.output<typeof MerchantOnboardingBody>;
export type ProfileForm = UseFormReturn<ProfileInput, unknown, ProfileOutput>;

export const PROFILE_STEP_FIELDS = {
  profile: ["merchant_name", "merchant_category", "description", "whatsapp_number"],
  location: ["lat", "lng", "address"],
  hours: ["operational_open_time", "operational_close_time", "default_surplus_start_time"],
  bank: ["bank_code", "bank_account_number", "bank_account_holder"],
} as const satisfies Record<string, readonly (keyof ProfileInput)[]>;

export const BANK_OPTIONS = ["BCA", "BRI", "BNI", "Mandiri", "BSI", "SeaBank", "GoPay", "OVO", "DANA"] as const;

export function profileToFormValues(m: MerchantProfile): ProfileInput {
  return {
    merchant_name: m.merchant_name,
    merchant_category: m.merchant_category,
    description: m.description ?? "",
    address: m.address,
    lat: m.lat,
    lng: m.lng,
    whatsapp_number: m.whatsapp_number,
    operational_open_time: m.operational_open_time.slice(0, 5),
    operational_close_time: m.operational_close_time.slice(0, 5),
    default_surplus_start_time: m.default_surplus_start_time.slice(0, 5),
    bank_code: normalizeBankCode(m.bank_code),
    bank_account_number: "", // write-only: never prefilled
    bank_account_holder: m.bank_account_holder ?? "",
  };
}

/** Saved code → matching chip label ("MANDIRI" → "Mandiri"); unknown codes are kept as-is. */
export function normalizeBankCode(code: string | null | undefined): string {
  if (!code) return "";
  return BANK_OPTIONS.find((b) => b.toLowerCase() === code.toLowerCase()) ?? code;
}

/** Submit payload: blank optional fields dropped. */
export function profilePayload(values: ProfileOutput) {
  return stripEmpty(values) as ProfileOutput;
}

function useFieldIds(prefix: string) {
  const uid = useId();
  return (k: string) => `${prefix}-${uid}-${k}`;
}

export function ProfileSection({ form, idPrefix = "pf" }: { form: ProfileForm; idPrefix?: string }) {
  const id = useFieldIds(idPrefix);
  const { register, control, formState } = form;
  const e = formState.errors;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={id("name")} className="text-sm font-semibold">
          Nama warung
        </Label>
        <Input
          id={id("name")}
          placeholder="Warung Nasi Teh Euis"
          autoComplete="organization"
          className="h-12 rounded-2xl bg-card text-base"
          aria-invalid={e.merchant_name ? true : undefined}
          {...register("merchant_name")}
        />
        <FieldError>{e.merchant_name?.message}</FieldError>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Jenis makanan utama</legend>
        <Controller
          control={control}
          name="merchant_category"
          render={({ field }) => (
            <div role="radiogroup" aria-label="Kategori warung" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MENU_CATEGORIES.filter((c) => c !== "MYSTERY_BAG").map((c) => {
                const Icon = CATEGORY_ICONS[c];
                const active = (field.value ?? "MAKANAN_BERAT") === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => field.onChange(c)}
                    className={cn(
                      "flex h-12 items-center gap-2 rounded-2xl px-3 text-left text-sm font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      active ? "bg-brand-soft text-secondary-foreground ring-2 ring-primary" : "bg-card ring-border hover:bg-muted",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="truncate">{MENU_CATEGORY_LABELS[c]}</span>
                  </button>
                );
              })}
            </div>
          )}
        />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor={id("wa")} className="text-sm font-semibold">
          Nomor WhatsApp warung
        </Label>
        <Controller
          control={control}
          name="whatsapp_number"
          render={({ field }) => (
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-primary">
                <MessageCircleIcon className="size-4" aria-hidden />
              </span>
              <Input
                id={id("wa")}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0812 3456 7890"
                value={field.value ?? ""}
                onBlur={field.onBlur}
                onChange={(ev) => field.onChange(sanitizePhone(ev.target.value))}
                aria-invalid={e.whatsapp_number ? true : undefined}
                className="h-12 rounded-2xl bg-card pl-11 text-base tabular-nums"
              />
            </div>
          )}
        />
        {e.whatsapp_number ? (
          <FieldError>{e.whatsapp_number.message}</FieldError>
        ) : (
          <p className="text-xs text-muted-foreground">Dipakai tombol “Hubungi Warung” di tiket pembeli.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={id("desc")} className="text-sm font-semibold">
          Deskripsi singkat <span className="font-normal text-muted-foreground">(opsional)</span>
        </Label>
        <Textarea
          id={id("desc")}
          rows={2}
          placeholder="Masakan rumahan prasmanan langganan mahasiswa."
          className="rounded-2xl bg-card text-base"
          {...register("description")}
        />
        <FieldError>{e.description?.message}</FieldError>
      </div>
    </div>
  );
}

export function LocationSection({ form, idPrefix = "loc" }: { form: ProfileForm; idPrefix?: string }) {
  const id = useFieldIds(idPrefix);
  const { register, control, setValue, formState } = form;
  const e = formState.errors;
  const lat = useWatch({ control, name: "lat" }) as number | undefined;
  const lng = useWatch({ control, name: "lng" }) as number | undefined;
  const value = typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-semibold">Titik lokasi warung</p>
        <LocationPickerMap
          value={value}
          onChange={(v) => {
            setValue("lat", v.lat, { shouldDirty: true, shouldValidate: formState.isSubmitted || Boolean(e.lat) });
            setValue("lng", v.lng, { shouldDirty: true, shouldValidate: formState.isSubmitted || Boolean(e.lng) });
          }}
          heightClassName="h-64 sm:h-72"
        />
        <FieldError>{e.lat?.message ?? e.lng?.message}</FieldError>
        <p className="mt-1 text-xs text-muted-foreground">Pembeli dalam radius 2 km dari titik ini akan melihat surplusmu.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={id("addr")} className="text-sm font-semibold">
          Alamat lengkap
        </Label>
        <Textarea
          id={id("addr")}
          rows={2}
          placeholder="Jl. Babakan Raya No. 12, Babakan, Dramaga, Kab. Bogor"
          autoComplete="street-address"
          className="rounded-2xl bg-card text-base"
          aria-invalid={e.address ? true : undefined}
          {...register("address")}
        />
        <FieldError>{e.address?.message}</FieldError>
      </div>
    </div>
  );
}

export function HoursSection({ form, idPrefix = "hrs" }: { form: ProfileForm; idPrefix?: string }) {
  const id = useFieldIds(idPrefix);
  const { register, formState } = form;
  const e = formState.errors;
  const fields = [
    { name: "operational_open_time", label: "Jam buka", hint: "Warung mulai melayani" },
    { name: "operational_close_time", label: "Jam tutup", hint: "Default batas ambil surplus" },
    { name: "default_surplus_start_time", label: "Mulai surplus", hint: "Saat sisa biasanya mulai ada" },
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {fields.map((f) => (
        <div key={f.name} className="rounded-2xl bg-card p-3 ring-1 ring-border">
          <Label htmlFor={id(f.name)} className="text-xs font-semibold text-muted-foreground">
            {f.label}
          </Label>
          <input
            id={id(f.name)}
            type="time"
            className="mt-1 h-11 w-full rounded-xl bg-transparent text-2xl font-extrabold tabular-nums outline-none focus-visible:bg-muted"
            aria-invalid={e[f.name] ? true : undefined}
            {...register(f.name)}
          />
          {e[f.name] ? <FieldError>{e[f.name]?.message}</FieldError> : <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function BankSection({
  form,
  idPrefix = "bank",
  savedNumberMasked,
}: {
  form: ProfileForm;
  idPrefix?: string;
  /** Masked saved account number ("••••6789"); the full number is write-only. */
  savedNumberMasked?: string | null;
}) {
  const id = useFieldIds(idPrefix);
  const { register, control, formState } = form;
  const e = formState.errors;
  const savedCode = form.formState.defaultValues?.bank_code;
  const options: readonly string[] =
    savedCode && !(BANK_OPTIONS as readonly string[]).includes(savedCode) ? [...BANK_OPTIONS, savedCode] : BANK_OPTIONS;
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Bank / e-wallet</legend>
        <Controller
          control={control}
          name="bank_code"
          render={({ field }) => (
            <div role="radiogroup" aria-label="Bank atau e-wallet" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {options.map((b) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={field.value === b}
                  onClick={() => field.onChange(field.value === b ? "" : b)}
                  className={cn(
                    "h-10 truncate rounded-full px-3 text-sm font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    field.value === b ? "bg-foreground text-background ring-foreground" : "bg-card ring-border hover:bg-muted",
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
          )}
        />
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={id("acc")} className="text-sm font-semibold">
            Nomor rekening / HP
          </Label>
          <Input
            id={id("acc")}
            inputMode="numeric"
            autoComplete="off"
            placeholder={savedNumberMasked ?? "1234567890"}
            aria-describedby={savedNumberMasked && !e.bank_account_number ? id("acc-hint") : undefined}
            className="h-12 rounded-2xl bg-card text-base tabular-nums"
            {...register("bank_account_number")}
          />
          {e.bank_account_number ? (
            <FieldError>{e.bank_account_number.message}</FieldError>
          ) : savedNumberMasked ? (
            <p id={id("acc-hint")} className="text-[11px] text-muted-foreground">
              Tersimpan: <span className="tabular-nums">{savedNumberMasked}</span> — isi untuk mengganti
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={id("holder")} className="text-sm font-semibold">
            Nama pemilik
          </Label>
          <Input id={id("holder")} autoComplete="name" placeholder="Nama sesuai rekening" className="h-12 rounded-2xl bg-card text-base" {...register("bank_account_holder")} />
          <FieldError>{e.bank_account_holder?.message}</FieldError>
        </div>
      </div>
    </div>
  );
}
