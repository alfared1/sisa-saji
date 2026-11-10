"use client";

import Link from "next/link";
import { ArrowRightIcon, BrainCircuitIcon, CheckIcon, GiftIcon, MegaphoneIcon } from "lucide-react";
import type { TonightPrediction } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { percent, roundPortions } from "../lib/logic";
import { ModelBadge } from "../ui";

function clock(hhmm: string) {
  return hhmm.slice(0, 5).replace(":", ".");
}

/** Blueprint AIPredictionAlertCard — tonight's Surplus Prediction Engine insight. */
export function AiPredictionAlertCard({
  prediction,
  publishedMenuIds,
  className,
}: {
  prediction: TonightPrediction | null;
  /** Menus that already have a live batch tonight (chips show "Sudah tayang"). */
  publishedMenuIds: ReadonlySet<string>;
  className?: string;
}) {
  // Cold start: a brand-new warung gets ~0 portions at low confidence — say so honestly.
  const coldStart = !prediction || roundPortions(prediction.predicted_surplus_portions) < 1;
  if (coldStart) {
    return (
      <section className={cn("rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5", className)} aria-label="Prediksi surplus">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <BrainCircuitIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">AI sedang mengenal warungmu</h2>
              {prediction && <ModelBadge version={prediction.model_version} />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Prediksi porsi sisa muncul setelah beberapa malam riwayat surplus. Publikasikan porsi sisa seperti biasa — makin sering, makin akurat.
            </p>
            <Link href="/merchant/surplus/new" className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground">
              <MegaphoneIcon className="size-4" /> Publikasikan surplus
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!prediction) return null;
  const portions = roundPortions(prediction.predicted_surplus_portions);
  const menus = [...prediction.per_menu].sort((a, b) => b.predicted_surplus_portions - a.predicted_surplus_portions);
  const top = menus.find((m) => !publishedMenuIds.has(m.menu_id)) ?? menus[0];
  const confidence = percent(prediction.confidence_score);

  return (
    <section
      aria-label="Prediksi surplus malam ini"
      className={cn(
        "relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-strong via-primary to-emerald-600 p-4 text-white shadow-float sm:p-5 dark:from-emerald-800 dark:via-emerald-700 dark:to-emerald-900",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-10 -bottom-16 size-56 rounded-full bg-white/10 blur-2xl" aria-hidden />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase ring-1 ring-white/20">
            <BrainCircuitIcon className="size-3.5" aria-hidden /> Surplus Prediction Engine
          </span>
          <ModelBadge version={prediction.model_version} tone="onDark" />
        </div>

        <p className="mt-3 text-lg leading-snug font-extrabold sm:text-xl">
          Prediksi malam ini: ~{portions} porsi berpotensi sisa pada pukul {clock(prediction.peak_hour)}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/85">
          <span className="inline-flex items-center gap-2">
            <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-white/20" aria-hidden>
              <span className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: confidence }} />
            </span>
            Keyakinan <b className="text-white tabular-nums">{confidence}</b>
          </span>
          <span>
            Peluang habis @50%: <b className="text-white tabular-nums">{percent(prediction.sellout_probability_at_50pct)}</b>
          </span>
        </div>

        {menus.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Prediksi per menu">
            {menus.map((m) => {
              const live = publishedMenuIds.has(m.menu_id);
              return (
                <li key={m.menu_id}>
                  <Link
                    href={`/merchant/surplus/new?menu=${m.menu_id}`}
                    className={cn(
                      "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-white/60",
                      // White chip: fixed dark ink, since the theme tokens turn light in dark mode.
                      live ? "bg-white/10 text-white/70 ring-white/15" : "bg-white text-neutral-900 ring-white hover:bg-white/90",
                    )}
                  >
                    {/kejutan|mystery/i.test(m.menu_name) && (
                      <GiftIcon className={cn("size-3.5 shrink-0 text-deal", !live && "dark:text-orange-600")} aria-hidden />
                    )}
                    <span className="truncate">{m.menu_name}</span>
                    {live ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-white/70">
                        <CheckIcon className="size-3.5" aria-hidden />
                        tayang
                      </span>
                    ) : roundPortions(m.predicted_surplus_portions) > 0 ? (
                      <span className="shrink-0 font-extrabold text-primary tabular-nums dark:text-emerald-700">~{roundPortions(m.predicted_surplus_portions)}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Link
          href={top ? `/merchant/surplus/new?menu=${top.menu_id}` : "/merchant/surplus/new"}
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-extrabold text-primary shadow-card outline-none transition-transform active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-white/60 sm:w-auto dark:text-emerald-700"
        >
          <MegaphoneIcon className="size-4" />
          Publikasikan sekarang
          <ArrowRightIcon className="size-4" />
        </Link>
      </div>
    </section>
  );
}
