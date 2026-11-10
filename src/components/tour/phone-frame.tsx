import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Artboard width of every preview screen (CSS px before scaling). */
export const PHONE_SCREEN_WIDTH = 300;

/**
 * Scrolls the screen content up, like a real phone, just far enough that the
 * highlighted element and its callout sit above the stage's bottom fade (which
 * starts at 88 % of the stage height). Inputs, all CSS variables:
 *  - `--focus`: artboard y, from the top of the content (under the status
 *    bar), of the lowest edge of the highlighted element;
 *  - `--focus-below`: on-screen px that must stay visible under that edge (the
 *    callout, when it sits below its target);
 *  - `--pad` (stage padding above the phone), `--z` (phone scale) and `100cqh`
 *    (stage height: the stage is a size container).
 * 44 px = bezel (8) + status bar (36). On tall stages the result is positive
 * and min() keeps the content at the top.
 */
const SCROLL_TO_FOCUS =
  "0 min(0px, calc((90cqh - var(--pad, 0px) - var(--focus-below, 0px)) / var(--z, 1) - 44px - var(--focus, 0px)))";

/**
 * A phone rising out of the stage: dark bezel, cropped at the bottom, with a
 * 300 px wide screen drawn at app scale and then scaled by `--z` (set on the
 * stage per breakpoint). Scaling the whole artboard keeps the real app
 * components (PriceTag, DiscountBadge, QrCodeView…) at their own proportions
 * instead of re-styling them for a small frame.
 */
export function PhoneFrame({ children, time, className }: { children: ReactNode; time: string; className?: string }) {
  return (
    <div className={cn("relative mx-auto h-full w-[calc(316px*var(--z))]", className)}>
      <div className="absolute top-0 left-0 w-[316px] origin-top-left scale-(--z)">
        {/* Dark mode: a lighter bezel and a faint outline, so the phone does not melt into the dark stage. */}
        <div className="rounded-t-[46px] bg-[#1c2520] p-2 pb-0 shadow-float ring-1 ring-black/10 dark:bg-[#2a332e] dark:shadow-[0_0_0_1px_rgba(255,255,255,.06),0_24px_60px_-20px_rgba(0,0,0,.8)] dark:ring-white/20">
          <div className="relative flex h-[720px] flex-col overflow-hidden rounded-t-[38px] bg-background text-foreground">
            <StatusBar time={time} />
            {/* Clips the scrolled content under the status bar. */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div className="px-3.5 pt-1" style={{ translate: SCROLL_TO_FOCUS }}>
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBar({ time }: { time: string }) {
  return (
    <div className="relative flex h-9 shrink-0 items-center justify-between px-6 font-bold">
      <span className="text-[12px] tabular-nums">{time}</span>
      <span className="absolute top-2 left-1/2 h-[24px] w-[88px] -translate-x-1/2 rounded-full bg-[#1c2520] dark:bg-[#111613]" />
      {/* Honest label: the screen is a sample, not live data. Divided by --z so it stays legible when scaled down. */}
      <span
        className="rounded-full bg-muted px-[0.55em] py-[0.2em] font-semibold text-muted-foreground"
        style={{ fontSize: "calc(10.5px / var(--z, 1))" }}
      >
        Contoh
      </span>
    </div>
  );
}
