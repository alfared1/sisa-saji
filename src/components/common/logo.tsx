import { cn } from "@/lib/utils";

/** Glyph paths shared with the generated PWA icons (src/app/icons). viewBox 0 0 64 64. */
export const LOGO_PATHS = {
  bowl: "M9 33h46a23 20 0 0 1-46 0z",
  rim: { x: 6, y: 29, width: 52, height: 6, rx: 3 },
  leafBig: "M32.5 28C31 16 38.5 7.5 53 7c1.2 13.5-7 21-20.5 21z",
  leafSmall: "M31 28c-.8-7-6-12.5-16-12.5.2 8.2 6.3 12.5 16 12.5z",
} as const;

export const LOGO_COLORS = {
  green: "#138a47",
  greenDark: "#0b6a35",
  leafLight: "#b7f0cd",
  orange: "#f5832a",
  cream: "#fbf8f3",
} as const;

export function LogoMark({ className, title = "Sisa-Saji" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} className={cn("size-9 shrink-0", className)}>
      {/* No gradient <defs>: duplicate ids break when the first copy is display:none. */}
      <rect width="64" height="64" rx="18" fill={LOGO_COLORS.green} />
      <path d="M0 18A18 18 0 0 1 18 0h28a18 18 0 0 1 18 18v6C44 18 20 20 0 34z" fill="#ffffff" fillOpacity="0.1" />
      <g transform="translate(6 7) scale(0.8125)">
        <path d={LOGO_PATHS.leafBig} fill={LOGO_COLORS.leafLight} />
        <path d={LOGO_PATHS.leafSmall} fill={LOGO_COLORS.orange} />
        <rect {...LOGO_PATHS.rim} fill="#ffffff" />
        <path d={LOGO_PATHS.bowl} fill="#ffffff" />
      </g>
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
