import { cn } from "@/lib/utils";

/**
 * Sisa-Saji mark: one cream silhouette in which a tudung saji (the woven cover
 * that keeps served food at a warung) grows a leaf from its top, over a soft
 * orange plate. A row of ketupat-shaped cut-outs hints at the weave; it is cut
 * out of the cover (even-odd fill), so the same paths also make the white
 * one-colour badge.
 *
 * Shared with the generated PWA icons (src/app/icons/render.tsx). viewBox 0 0 64 64.
 */
export const LOGO_PATHS = {
  cover:
    "M10 45C10 33.2 18.4 24.9 29.4 22.5C28.7 15 33.3 9.4 41.6 8.4C42 15.6 38.9 20.5 34.6 22.3C46 24.4 54 33.2 54 45Z",
  weave:
    "M17.1 38.2L19.6 35.1L22.1 38.2L19.6 41.3ZM23.3 38.2L25.8 35.1L28.3 38.2L25.8 41.3Z" +
    "M29.5 38.2L32 35.1L34.5 38.2L32 41.3ZM35.7 38.2L38.2 35.1L40.7 38.2L38.2 41.3Z" +
    "M41.9 38.2L44.4 35.1L46.9 38.2L44.4 41.3Z",
  plate: { x: 7, y: 48.5, width: 50, height: 4, rx: 2 },
} as const;

/** Tile green = the app's deep "impact" green (oklch 0.42 0.11 154). */
export const LOGO_COLORS = {
  green: "#005e2f",
  cream: "#fbf8f3",
  orange: "#f5a04a",
} as const;

/** The mark's foreground (cover with leaf, plate) inside a 64 × 64 box. `mono` = all white. */
export function LogoGlyph({ mono = false }: { mono?: boolean }) {
  return (
    <g>
      <path d={LOGO_PATHS.cover + LOGO_PATHS.weave} fillRule="evenodd" fill={mono ? "#ffffff" : LOGO_COLORS.cream} />
      <rect {...LOGO_PATHS.plate} fill={mono ? "#ffffff" : LOGO_COLORS.orange} />
    </g>
  );
}

export function LogoMark({ className, title = "Sisa-Saji" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} className={cn("size-9 shrink-0", className)}>
      <rect width="64" height="64" rx="15" fill={LOGO_COLORS.green} />
      <LogoGlyph />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={markClassName} />
      <span className="text-lg font-extrabold tracking-tight">
        Sisa<span className="text-primary">-Saji</span>
      </span>
    </span>
  );
}
