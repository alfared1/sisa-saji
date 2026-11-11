import { cn } from "@/lib/utils";

/**
 * Sisa-Saji mark: a tudung saji (the woven cover that keeps served food at a
 * warung) with a leaf as its handle, on an orange plate. The ketupat-shaped
 * weave is cut out of the cover (even-odd fill), so the same paths render the
 * colour mark on the green tile and the white one-colour badge.
 *
 * Shared with the generated PWA icons (src/app/icons/render.tsx). viewBox 0 0 64 64.
 */
export const LOGO_PATHS = {
  cover: "M9.5 46.5Q12.5 28 32 21Q51.5 28 54.5 46.5Z",
  weave:
    "M21.9 32L25 28.3L28.1 32L25 35.7ZM28.9 32L32 28.3L35.1 32L32 35.7ZM35.9 32L39 28.3L42.1 32L39 35.7Z" +
    "M14.9 39.7L18 36L21.1 39.7L18 43.4ZM21.9 39.7L25 36L28.1 39.7L25 43.4ZM28.9 39.7L32 36L35.1 39.7L32 43.4Z" +
    "M35.9 39.7L39 36L42.1 39.7L39 43.4ZM42.9 39.7L46 36L49.1 39.7L46 43.4Z",
  leaf: "M32 21.5C30.6 14.7 34.6 9.5 43 8.7C43.4 15.9 39 20.7 32 21.5Z",
  plate: { x: 6, y: 47, width: 52, height: 5.5, rx: 2.75 },
} as const;

export const LOGO_COLORS = {
  green: "#138a47",
  cream: "#fbf8f3",
  leaf: "#b7f0cd",
  orange: "#f5832a",
} as const;

/** The mark's foreground (cover, leaf, plate) inside a 64 × 64 box. `mono` = all white. */
export function LogoGlyph({ mono = false }: { mono?: boolean }) {
  return (
    <g>
      <path d={LOGO_PATHS.cover + LOGO_PATHS.weave} fillRule="evenodd" fill={mono ? "#ffffff" : LOGO_COLORS.cream} />
      <path d={LOGO_PATHS.leaf} fill={mono ? "#ffffff" : LOGO_COLORS.leaf} />
      <rect {...LOGO_PATHS.plate} fill={mono ? "#ffffff" : LOGO_COLORS.orange} />
    </g>
  );
}

export function LogoMark({ className, title = "Sisa-Saji" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} className={cn("size-9 shrink-0", className)}>
      <rect width="64" height="64" rx="16" fill={LOGO_COLORS.green} />
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
