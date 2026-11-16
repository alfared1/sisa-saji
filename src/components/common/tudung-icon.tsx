import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The tudung saji (woven food cover) from the logo as a line icon, drawn on the same 24px grid and
 * stroke as lucide so it sits next to lucide icons. Used where the product itself is the subject:
 * the active-order bar, the portion-locked moment, the collected order.
 */
export function TudungIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-6", className)}
      {...props}
    >
      <path d="M3 16.5Q6 9.5 12 8q6 1.5 9 8.5z" />
      <path d="M2.5 19.5h19" />
      <path d="M12 8c-.3-1.8.8-3.1 2.9-3.3.1 1.9-1 3.1-2.9 3.3z" />
    </svg>
  );
}

/**
 * Cover over a plate, with the cover animated on its own: `cover="settle"` drops it onto the plate
 * (a portion was just locked), `cover="lift"` raises it (the order was collected). Motion is off for
 * prefers-reduced-motion (globals.css).
 */
export function TudungPlate({
  cover = "still",
  className,
}: {
  cover?: "still" | "settle" | "lift";
  className?: string;
}) {
  return (
    <svg viewBox="0 0 64 48" fill="none" aria-hidden className={cn("h-12 w-16", className)}>
      <g
        className={cn(cover === "settle" && "animate-tudung", cover === "lift" && "animate-angkat")}
        style={{ transformBox: "fill-box" }}
      >
        <path d="M8 36Q16 15 32 12q16 3 24 24z" fill="currentColor" opacity={0.16} />
        <path
          d="M8 36Q16 15 32 12q16 3 24 24z"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinejoin="round"
        />
        <path d="M17 27.5 41 18M23 33l24-9.5M47 27.5 23 18M41 33 18.5 24.5" stroke="currentColor" strokeWidth={1.2} opacity={0.45} />
        <path d="M32 12c-.5-3.2 1.4-5.5 5.2-5.8.2 3.4-1.8 5.5-5.2 5.8z" fill="currentColor" />
      </g>
      <path d="M5 41h54" stroke="var(--color-plate)" strokeWidth={3.5} strokeLinecap="round" />
    </svg>
  );
}
