"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Product-tour highlight inside a phone preview: a ring around the target, a
 * short halo pulse (three beats, then still), and a callout bubble with an
 * arrow. The bubble is dark ink on light / light ink on dark (foreground on
 * background), so it reads in both themes without a new colour.
 *
 * The preview is scaled by `--z` (see ScreenPreview); the bubble divides its font
 * size by `--z` and sizes everything else in `em`, so its text keeps a fixed
 * on-screen size at every breakpoint while the phone itself shrinks or grows.
 * Place each callout over the least important part of its screen: the mocks
 * leave a gap where the bubble lands.
 */
export function Coachmark({
  children,
  label,
  side = "bottom",
  align = "center",
  radius = "rounded-2xl",
  block = false,
  className,
}: {
  children: ReactNode;
  label: string;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  /** Radius class matching the target, so the ring hugs it. */
  radius?: string;
  /** Stretch the wrapper to the row (cards) instead of shrink-wrapping (chips, badges). */
  block?: boolean;
  className?: string;
}) {
  const below = side === "bottom";

  // Render output never depends on the motion preference (that would break hydration):
  // the halo is hidden by CSS under prefers-reduced-motion, and MotionConfig
  // reducedMotion="user" (TourView) drops the callout's slide-in.
  return (
    <div className={cn("relative", block ? "flex w-full" : "inline-flex max-w-full", className)}>
      {children}
      <span aria-hidden className={cn("pointer-events-none absolute -inset-[5px] ring-[2.5px] ring-primary", radius)} />
      <motion.span
        aria-hidden
        className={cn("pointer-events-none absolute -inset-[5px] border-2 border-primary motion-reduce:hidden", radius)}
        initial={{ opacity: 0.75, scale: 1 }}
        animate={{ opacity: 0, scale: 1.16 }}
        transition={{ duration: 1.3, ease: "easeOut", repeat: 2, delay: 0.45 }}
      />
      <motion.span
        aria-hidden
        className={cn(
          "pointer-events-none absolute z-20 w-max rounded-[0.8em] bg-foreground font-semibold text-balance text-background shadow-float",
          below ? "top-[calc(100%+1.1em)]" : "bottom-[calc(100%+1.1em)]",
          align === "start" && "left-0",
          align === "end" && "right-0",
          align === "center" && "left-1/2 -translate-x-1/2",
        )}
        style={{
          // --callout (13 px, 14 px on laptops) is the size on screen; dividing by --z undoes the phone scale.
          fontSize: "calc(var(--callout, 13px) / var(--z, 1))",
          lineHeight: 1.3,
          padding: "0.6em 0.85em",
          // Never wider than the 300 px screen minus its padding, whatever the scale.
          maxWidth: "min(calc(232px / var(--z, 1)), 264px)",
        }}
        initial={{ opacity: 0, y: below ? -6 : 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.25, ease: "easeOut" }}
      >
        <span
          className={cn(
            "absolute size-[0.75em] rotate-45 rounded-[0.12em] bg-foreground",
            below ? "-top-[0.3em]" : "-bottom-[0.3em]",
            align === "start" && "left-[1.1em]",
            align === "end" && "right-[1.1em]",
            align === "center" && "left-1/2 -translate-x-1/2",
          )}
        />
        <span className="relative">{label}</span>
      </motion.span>
    </div>
  );
}
