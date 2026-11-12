import { cn } from "@/lib/utils";

/**
 * Sisa-Saji mark: a wide, shallow tudung saji (the woven cover that keeps
 * served food at every warung) with a leaf on its top, over a soft orange
 * plate. The criss-cross weave is pre-clipped to the cover's outline, so the
 * mark needs no <clipPath> (no duplicate ids when it repeats on a page, and
 * the PNG icon renderer draws it as is).
 *
 * Shared with the generated PWA icons (src/app/icons/render.tsx). viewBox 0 0 64 64.
 */
export const LOGO_PATHS = {
  cover: "M7 43Q15 25.5 32 21Q49 25.5 57 43Z",
  /** Weave lines, already clipped to `cover`. Stroked in the tile green. */
  weave:
    "M13.83 43L32.14 21.04M23.83 43L39.71 23.95M33.83 43L46.14 28.23M43.83 43L51.49 33.81M53.83 43L55.83 40.6" +
    "M14.17 43L9.79 37.74M24.17 43L14.52 31.43M34.17 43L20.3 26.36M44.17 43L27.18 22.61M54.17 43L37.37 22.84",
  leaf: "M32 21.3C31.2 16.4 34.2 13 39.6 12.4C39.9 17.4 37 20.7 32 21.3Z",
  plate: { x: 5, y: 45, width: 54, height: 4.4, rx: 2.2 },
} as const;

/** Tile green = the app's deep "impact" green (oklch 0.42 0.11 154). */
export const LOGO_COLORS = {
  green: "#005e2f",
  cream: "#fbf8f3",
  leaf: "#b7f0cd",
  orange: "#f5a04a",
} as const;

/**
 * The mark's foreground inside a 64 × 64 box. `mono` = one white silhouette
 * (cover, leaf, plate) for the status-bar badge, where the weave would not show.
 */
export function LogoGlyph({ mono = false }: { mono?: boolean }) {
  if (mono) {
    return (
      <g fill="#ffffff">
        <path d={LOGO_PATHS.cover} />
        <path d={LOGO_PATHS.leaf} />
        <rect {...LOGO_PATHS.plate} />
      </g>
    );
  }
  return (
    <g>
      <path d={LOGO_PATHS.cover} fill={LOGO_COLORS.cream} />
      <path d={LOGO_PATHS.weave} fill="none" stroke={LOGO_COLORS.green} strokeWidth={1.9} />
      <path d={LOGO_PATHS.leaf} fill={LOGO_COLORS.leaf} />
      <rect {...LOGO_PATHS.plate} fill={LOGO_COLORS.orange} />
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
