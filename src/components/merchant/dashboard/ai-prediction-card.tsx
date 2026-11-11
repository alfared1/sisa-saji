"use client";

import Link from "next/link";
import { ChartColumnIcon, CheckIcon, GiftIcon, MegaphoneIcon } from "lucide-react";
import type { TonightPrediction } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { roundPortions } from "../lib/logic";

function clock(hhmm: string) {
  return hhmm.slice(0, 5).replace(":", ".");
}

/** Confidence score in words a warung owner can act on. */
function confidenceText(score: number): string {
  if (score >= 0.75) return "Perkiraan ini cukup bisa dipegang, polanya mirip beberapa minggu terakhir.";
  if (score >= 0.5) return "Perkiraan kasar dari riwayat beberapa minggu terakhir.";
  return "Masih kasar, riwayat surplus warungmu belum banyak.";
}

/** Tonight's surplus forecast for the warung dashboard, in the owner's language. */
export function AiPredictionAlertCard({
  prediction,
  publishedMenuIds,
  className,
}: {
  prediction: TonightPrediction | null;
  /** Menus that already have a live batch tonight (chips show "tayang"). */
  publishedMenuIds: ReadonlySet<string>;
  className?: string;
}) {
  // Cold start: a brand-new warung gets ~0 portions at low confidence. Say so plainly.
  const coldStart = !prediction || roundPortions(prediction.predicted_surplus_portions) < 1;
  if (coldStart) {
    return (
      <section className={cn("rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5", className)} aria-label="Perkiraan surplus malam ini">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <ChartColumnIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">
              Perkiraan porsi sisa belum tersedia
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Perkiraan muncul setelah warungmu beberapa malam memasang surplus. Pasang porsi sisa seperti biasa, makin sering
              makin tepat.
            </p>
            <Link
              href="/merchant/surplus/new"
              className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <MegaphoneIcon className="size-4" aria-hidden /> Publikasikan surplus
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const portions = roundPortions(prediction.predicted_surplus_portions);
  const menus = [...prediction.per_menu].sort((a, b) => b.predicted_surplus_portions - a.predicted_surplus_portions);
  const top = menus.find((m) => !publishedMenuIds.has(m.menu_id)) ?? menus[0];
  const selloutOutOfTen = Math.round(prediction.sellout_probability_at_50pct * 10);

  return (
    <section
      aria-label="Perkiraan surplus malam ini"
      // Fixed deep green in both themes so the white text keeps its contrast.
      className={cn("rounded-3xl bg-impact p-4 text-white shadow-card sm:p-5", className)}
    >
      <p className="text-sm font-semibold text-white/85">Perkiraan malam ini</p>
      <h2 className="mt-1 text-lg leading-snug font-extrabold sm:text-xl">
        Sekitar {portions} porsi kemungkinan belum laku, paling banyak sekitar pukul {clock(prediction.peak_hour)}.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/85">
        {confidenceText(prediction.confidence_score)} Kalau dijual dengan diskon 50%, biasanya {selloutOutOfTen} dari 10 malam
        habis.
      </p>

      {menus.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Perkiraan per menu">
          {menus.map((m) => {
            const live = publishedMenuIds.has(m.menu_id);
            const left = roundPortions(m.predicted_surplus_portions);
            return (
              <li key={m.menu_id}>
                <Link
                  href={`/merchant/surplus/new?menu=${m.menu_id}`}
                  className={cn(
                    "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-white/60",
                    // White chip: fixed dark ink, since the theme tokens turn light in dark mode.
                    live ? "bg-white/10 text-white/80 ring-white/15" : "bg-white text-neutral-900 ring-white hover:bg-white/90",
                  )}
                >
                  {/kejutan|mystery/i.test(m.menu_name) && (
                    <GiftIcon className={cn("size-3.5 shrink-0 text-deal", !live && "dark:text-orange-600")} aria-hidden />
                  )}
                  <span className="truncate">{m.menu_name}</span>
                  {live ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5">
                      <CheckIcon className="size-3.5" aria-hidden />
                      tayang
                    </span>
                  ) : left > 0 ? (
                    <span className="shrink-0 font-extrabold text-impact tabular-nums">±{left}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href={top ? `/merchant/surplus/new?menu=${top.menu_id}` : "/merchant/surplus/new"}
        className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-extrabold text-impact outline-none transition-colors hover:bg-white/90 focus-visible:ring-3 focus-visible:ring-white/60 sm:w-auto"
      >
        <MegaphoneIcon className="size-4" aria-hidden />
        Publikasikan sekarang
      </Link>
    </section>
  );
}
