"use client";

import { useId, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LAUK_OPTIONS_MAX, MENU_CONTENTS_MAX } from "@/lib/constants";
import { MENU_CATEGORY_LABELS, MERCHANT_MENU_CATEGORIES, MenuCreateBody, type MenuView } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { parseIntLoose, suggestMinPrice } from "../lib/logic";
import { ZOD_ID_OPTIONS } from "../lib/zod-id";
import { FieldError, MoneyInput } from "../ui";
import { ItemListInput } from "./item-list-input";

export type MenuFormInput = z.input<typeof MenuCreateBody>;
export type MenuFormOutput = z.output<typeof MenuCreateBody>;

const WEIGHT_PRESETS = [150, 200, 250, 300, 500];

/** Message of the first invalid entry of a list field (react-hook-form nests them by index). */
function firstItemError(errors: unknown): string | undefined {
  if (!errors || typeof errors !== "object") return undefined;
  for (const entry of Object.values(errors)) {
    if (entry && typeof entry === "object" && "message" in entry && typeof entry.message === "string") return entry.message;
  }
  return undefined;
}

export function menuToFormValues(m: MenuView): MenuFormInput {
  return {
    menu_name: m.menu_name,
    category: m.category,
    description: m.description ?? "",
    original_price_idr: m.original_price_idr,
    min_recovery_price_idr: m.min_recovery_price_idr,
    portion_weight_grams: m.portion_weight_grams,
    contents: m.contents,
    lauk_options: m.lauk_options,
  };
}

export const EMPTY_MENU: MenuFormInput = {
  menu_name: "",
  category: "MAKANAN_BERAT",
  description: "",
  original_price_idr: undefined as unknown as number,
  min_recovery_price_idr: undefined as unknown as number,
  portion_weight_grams: 200,
  contents: [],
  lauk_options: [],
};

/**
 * Create/edit menu form, validated with the contract MenuCreateBody schema: a menu lists
 * what is always in the portion ("Isi porsi") and, optionally, the lauk the buyer picks one of.
 */
export function MenuForm({
  defaultValues = EMPTY_MENU,
  onSubmit,
  submitLabel,
  pending,
  secondary,
  actionsClassName,
  idPrefix = "menu",
}: {
  defaultValues?: MenuFormInput;
  onSubmit: (values: MenuFormOutput) => void;
  submitLabel: ReactNode;
  pending?: boolean;
  /** Extra action placed before the submit button (e.g. "Kembali"). */
  secondary?: ReactNode;
  /** Extra classes for the actions row (the onboarding wizard makes it its sticky bar). */
  actionsClassName?: string;
  idPrefix?: string;
}) {
  const uid = useId();
  const id = (k: string) => `${idPrefix}-${uid}-${k}`;
  const form = useForm<MenuFormInput, unknown, MenuFormOutput>({
    resolver: zodResolver(MenuCreateBody, ZOD_ID_OPTIONS),
    defaultValues,
    mode: "onTouched",
  });
  const { register, control, handleSubmit, setValue, formState } = form;
  const errors = formState.errors;
  const original = useWatch({ control, name: "original_price_idr" });
  const minPrice = useWatch({ control, name: "min_recovery_price_idr" });
  const suggested = original ? suggestMinPrice(original) : 0;
  // New menus only: keep the floor at the suggested 30 % until the merchant edits it.
  const autoFloor = defaultValues.min_recovery_price_idr == null;
  const floorPct = original && minPrice ? Math.round((minPrice / original) * 100) : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={id("name")} className="text-sm font-semibold">
          Nama menu
        </Label>
        <Input
          id={id("name")}
          placeholder="Nasi Timbel + Lauk Pilihan"
          className="h-12 rounded-2xl bg-card text-base"
          aria-invalid={errors.menu_name ? true : undefined}
          aria-describedby={errors.menu_name ? id("name-err") : undefined}
          {...register("menu_name")}
        />
        <FieldError id={id("name-err")}>{errors.menu_name?.message}</FieldError>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Kategori</legend>
        <Controller
          control={control}
          name="category"
          render={({ field }) => (
            <div role="radiogroup" aria-label="Kategori menu" className="flex flex-wrap gap-2">
              {MERCHANT_MENU_CATEGORIES.map((c) => {
                const active = field.value === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => field.onChange(c)}
                    className={cn(
                      "inline-flex h-10 items-center rounded-full px-3.5 text-sm font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      active ? "bg-primary text-primary-foreground ring-primary" : "bg-card ring-border hover:bg-muted",
                    )}
                  >
                    {MENU_CATEGORY_LABELS[c]}
                  </button>
                );
              })}
            </div>
          )}
        />
        {/* An old surprise menu being edited has no valid category yet: the schema asks for one. */}
        <FieldError>{errors.category?.message}</FieldError>
      </fieldset>

      <Controller
        control={control}
        name="contents"
        render={({ field }) => (
          <ItemListInput
            id={id("contents")}
            label="Isi porsi"
            helper="Tulis satu per satu yang selalu ada di porsi ini, misalnya nasi timbel, sayur asem, lalapan."
            placeholder="Contoh: Sayur asem"
            value={field.value ?? []}
            onChange={field.onChange}
            onBlur={field.onBlur}
            max={MENU_CONTENTS_MAX}
            error={errors.contents?.message ?? errors.contents?.root?.message ?? firstItemError(errors.contents)}
          />
        )}
      />

      <Controller
        control={control}
        name="lauk_options"
        render={({ field }) => (
          <ItemListInput
            id={id("lauk")}
            label="Lauk pilihan pembeli"
            optionalLabel="(opsional)"
            helper="Pembeli memilih satu lauk dari daftar ini. Kosongkan bila isinya tetap."
            placeholder="Contoh: Ayam goreng"
            value={field.value ?? []}
            onChange={field.onChange}
            onBlur={field.onBlur}
            max={LAUK_OPTIONS_MAX}
            error={errors.lauk_options?.message ?? errors.lauk_options?.root?.message ?? firstItemError(errors.lauk_options)}
          />
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={id("price")} className="text-sm font-semibold">
            Harga normal
          </Label>
          <Controller
            control={control}
            name="original_price_idr"
            render={({ field }) => (
              <MoneyInput
                id={id("price")}
                value={field.value}
                onBlur={field.onBlur}
                onChange={(v) => {
                  field.onChange(v ?? undefined);
                  if (v && autoFloor && !form.getFieldState("min_recovery_price_idr").isDirty) {
                    setValue("min_recovery_price_idr", suggestMinPrice(v), { shouldValidate: formState.isSubmitted });
                  }
                }}
                placeholder="18.000"
                invalid={Boolean(errors.original_price_idr)}
                describedBy={errors.original_price_idr ? id("price-err") : undefined}
              />
            )}
          />
          <FieldError id={id("price-err")}>{errors.original_price_idr?.message}</FieldError>
        </div>
        <div className="space-y-2">
          <Label htmlFor={id("floor")} className="text-sm font-semibold">
            Harga minimum
          </Label>
          <Controller
            control={control}
            name="min_recovery_price_idr"
            render={({ field }) => (
              <MoneyInput
                id={id("floor")}
                value={field.value}
                onBlur={field.onBlur}
                onChange={(v) => field.onChange(v ?? undefined)}
                placeholder="5.500"
                invalid={Boolean(errors.min_recovery_price_idr)}
                describedBy={errors.min_recovery_price_idr ? id("floor-err") : id("floor-hint")}
              />
            )}
          />
          {errors.min_recovery_price_idr ? (
            <FieldError id={id("floor-err")}>{errors.min_recovery_price_idr.message}</FieldError>
          ) : (
            <p id={id("floor-hint")} className="text-xs text-pretty text-muted-foreground">
              Diskon otomatis tidak akan menembus harga ini{floorPct !== null ? ` (${floorPct}% dari normal)` : ""}.
            </p>
          )}
        </div>
      </div>

      {suggested > 0 && minPrice !== suggested && (
        <button
          type="button"
          onClick={() => setValue("min_recovery_price_idr", suggested, { shouldDirty: true, shouldValidate: true })}
          className="-mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-brand-soft px-3 text-xs font-semibold text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Pakai saran 30%: {formatIdr(suggested)}
        </button>
      )}

      <div className="space-y-2">
        <Label htmlFor={id("weight")} className="text-sm font-semibold">
          Berat per porsi
        </Label>
        <Controller
          control={control}
          name="portion_weight_grams"
          render={({ field }) => (
            <div className="space-y-2">
              <div className="relative w-32">
                <Input
                  id={id("weight")}
                  inputMode="numeric"
                  value={field.value ?? ""}
                  onBlur={field.onBlur}
                  onChange={(e) => field.onChange(parseIntLoose(e.target.value) ?? undefined)}
                  aria-invalid={errors.portion_weight_grams ? true : undefined}
                  className="h-12 rounded-2xl bg-card pr-10 text-base font-semibold tabular-nums"
                />
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-sm text-muted-foreground">g</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {WEIGHT_PRESETS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => field.onChange(w)}
                    aria-pressed={field.value === w}
                    className={cn(
                      "h-10 rounded-full px-3 text-xs font-semibold tabular-nums ring-1",
                      field.value === w ? "bg-foreground text-background ring-foreground" : "bg-card ring-border hover:bg-muted",
                    )}
                  >
                    {w} g
                  </button>
                ))}
              </div>
            </div>
          )}
        />
        <FieldError>{errors.portion_weight_grams?.message}</FieldError>
        <p className="text-xs text-muted-foreground">Dipakai untuk menghitung kg pangan & CO₂e yang diselamatkan.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={id("desc")} className="text-sm font-semibold">
          Deskripsi <span className="font-normal text-muted-foreground">(opsional)</span>
        </Label>
        <Textarea
          id={id("desc")}
          rows={2}
          placeholder="Nasi timbel hangat dengan lauk pilihan, sambal terasi ulek sendiri."
          className="rounded-2xl bg-card text-base"
          {...register("description")}
        />
        <FieldError>{errors.description?.message}</FieldError>
      </div>

      <div className={cn("flex gap-2 pt-1 sm:justify-end", actionsClassName)}>
        {secondary}
        <Button type="submit" className={cn("h-12 flex-1 rounded-xl px-4 text-base font-semibold sm:px-6", !secondary && "sm:flex-none")} disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
