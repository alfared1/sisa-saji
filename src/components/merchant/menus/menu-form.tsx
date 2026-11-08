"use client";

import { useId, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { GiftIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { CATEGORY_ICONS } from "@/components/common/category-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MENU_CATEGORIES, MENU_CATEGORY_LABELS, MenuCreateBody, type MenuView } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { parseIntLoose, suggestMinPrice } from "../lib/logic";
import { ZOD_ID_OPTIONS } from "../lib/zod-id";
import { FieldError, MoneyInput } from "../ui";

export type MenuFormInput = z.input<typeof MenuCreateBody>;
export type MenuFormOutput = z.output<typeof MenuCreateBody>;

const WEIGHT_PRESETS = [150, 200, 250, 300, 500];

export function menuToFormValues(m: MenuView): MenuFormInput {
  return {
    menu_name: m.menu_name,
    category: m.category,
    description: m.description ?? "",
    original_price_idr: m.original_price_idr,
    min_recovery_price_idr: m.min_recovery_price_idr,
    portion_weight_grams: m.portion_weight_grams,
    is_mystery_bag: m.is_mystery_bag,
  };
}

export const EMPTY_MENU: MenuFormInput = {
  menu_name: "",
  category: "MAKANAN_BERAT",
  description: "",
  original_price_idr: undefined as unknown as number,
  min_recovery_price_idr: undefined as unknown as number,
  portion_weight_grams: 200,
  is_mystery_bag: false,
};

/** Create/edit menu form, validated with the contract MenuCreateBody schema. */
export function MenuForm({
  defaultValues = EMPTY_MENU,
  onSubmit,
  submitLabel,
  pending,
  secondary,
  idPrefix = "menu",
}: {
  defaultValues?: MenuFormInput;
  onSubmit: (values: MenuFormOutput) => void;
  submitLabel: ReactNode;
  pending?: boolean;
  secondary?: ReactNode;
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
  const mystery = useWatch({ control, name: "is_mystery_bag" });
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
          placeholder={mystery ? "Paket Kejutan Malam" : "Nasi Ayam Goreng Lengkuas"}
          className="h-12 rounded-2xl bg-card text-base"
          aria-invalid={errors.menu_name ? true : undefined}
          aria-describedby={errors.menu_name ? id("name-err") : undefined}
          {...register("menu_name")}
        />
        <FieldError id={id("name-err")}>{errors.menu_name?.message}</FieldError>
      </div>

      <Controller
        control={control}
        name="is_mystery_bag"
        render={({ field }) => (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-2xl p-3 ring-1 transition-colors",
              field.value ? "bg-deal-soft ring-deal/40" : "bg-card ring-border",
            )}
          >
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-deal text-deal-foreground">
              <GiftIcon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Paket Kejutan (Mystery Bag)</span>
              <span className="block text-xs text-muted-foreground">Isi campuran sisa hari itu — paling cepat habis.</span>
            </span>
            <Switch
              checked={Boolean(field.value)}
              onCheckedChange={(v) => {
                field.onChange(v);
                if (v) setValue("category", "MYSTERY_BAG");
                else setValue("category", "MAKANAN_BERAT");
              }}
              aria-label="Paket Kejutan"
            />
          </label>
        )}
      />

      {!mystery && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Kategori</legend>
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Kategori menu" className="flex flex-wrap gap-2">
                {MENU_CATEGORIES.filter((c) => c !== "MYSTERY_BAG").map((c) => {
                  const Icon = CATEGORY_ICONS[c];
                  const active = field.value === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => field.onChange(c)}
                      className={cn(
                        "inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        active ? "bg-foreground text-background ring-foreground" : "bg-card ring-border hover:bg-muted",
                      )}
                    >
                      <Icon className="size-4" /> {MENU_CATEGORY_LABELS[c]}
                    </button>
                  );
                })}
              </div>
            )}
          />
        </fieldset>
      )}

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
            <p id={id("floor-hint")} className="text-xs text-muted-foreground">
              Diskon AI tidak akan menembus harga ini{floorPct !== null ? ` (${floorPct}% dari normal)` : ""}.
            </p>
          )}
        </div>
      </div>

      {suggested > 0 && minPrice !== suggested && (
        <button
          type="button"
          onClick={() => setValue("min_recovery_price_idr", suggested, { shouldDirty: true, shouldValidate: true })}
          className="-mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-violet-100 px-3 text-xs font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
        >
          <SparklesIcon className="size-3.5" /> Pakai saran 30%: {formatIdr(suggested)}
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
            <div className="flex flex-wrap items-center gap-2">
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
              {WEIGHT_PRESETS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => field.onChange(w)}
                  aria-pressed={field.value === w}
                  className={cn(
                    "h-10 rounded-full px-3 text-xs font-bold tabular-nums ring-1",
                    field.value === w ? "bg-foreground text-background ring-foreground" : "bg-card ring-border hover:bg-muted",
                  )}
                >
                  {w} g
                </button>
              ))}
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
          placeholder={mystery ? "Isi bisa nasi + 2 lauk + sayur, tergantung sisa hari ini." : "Nasi, ayam goreng lengkuas, sambal, lalapan."}
          className="rounded-2xl bg-card text-base"
          {...register("description")}
        />
        <FieldError>{errors.description?.message}</FieldError>
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {secondary}
        <Button type="submit" className="h-12 rounded-full px-6 text-base font-bold" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
