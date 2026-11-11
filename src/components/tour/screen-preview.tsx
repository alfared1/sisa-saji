import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Artboard width of every preview screen (CSS px before scaling). */
export const PHONE_SCREEN_WIDTH = 300;

/**
 * Scrolls the screen content up just far enough that the highlighted element
 * and its callout sit above the stage's bottom fade (which starts at 88 % of
 * the stage height). Inputs, all CSS variables:
 *  - `--focus`: artboard y, from the top of the content (under the label bar),
 *    of the lowest edge of the highlighted element;
 *  - `--focus-below`: on-screen px that must stay visible under that edge (the
 *    callout, when it sits below its target);
 *  - `--pad` (stage padding above the preview), `--z` (preview scale) and
 *    `100cqh` (stage height: the stage is a size container).
 * 44 px = frame (8) + label bar (36). On tall stages the result is positive
 * and min() keeps the content at the top.
 */
const SCROLL_TO_FOCUS =
  "0 min(0px, calc((90cqh - var(--pad, 0px) - var(--focus-below, 0px)) / var(--z, 1) - 44px - var(--focus, 0px)))";

/**
 * A preview of one app screen, built from the app's real components and drawn
 * at app scale (300 px wide), then scaled by `--z` per breakpoint. No device
 * chrome: the top bar says plainly that this is a sample and at what time of
 * the evening the scene takes place.
 */
export function ScreenPreview({ children, time, className }: { children: ReactNode; time: string; className?: string }) {
  return (
    <div className={cn("relative mx-auto h-full w-[calc(316px*var(--z))]", className)}>
      <div className="absolute top-0 left-0 w-[316px] origin-top-left scale-(--z)">
        <div className="rounded-t-3xl bg-card p-2 pb-0 shadow-card ring-1 ring-border">
          <div className="relative flex h-[720px] flex-col overflow-hidden rounded-t-xl bg-background text-foreground ring-1 ring-border">
            <LabelBar time={time} />
            {/* Clips the scrolled content under the label bar. */}
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

function LabelBar({ time }: { time: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-border px-3.5">
      {/* Divided by --z so the label stays legible when the preview is scaled down. */}
      <span className="font-semibold text-muted-foreground" style={{ fontSize: "calc(11px / var(--z, 1))" }}>
        Contoh tampilan · pukul {time}
      </span>
    </div>
  );
}
