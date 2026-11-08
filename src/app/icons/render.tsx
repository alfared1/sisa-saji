/**
 * Shared renderer for the generated PNG app icons (next/og ImageResponse).
 * Same glyph as <LogoMark /> (src/components/common/logo.tsx).
 *
 *  - "any":      rounded green tile with the bowl + leaves
 *  - "maskable": full-bleed square, glyph inside the 80 % safe zone
 *  - "badge":    white glyph on transparent (Android status-bar badge)
 */
import { ImageResponse } from "next/og";
import { LOGO_COLORS, LOGO_PATHS } from "@/components/common/logo";

export type IconVariant = "any" | "maskable" | "badge";

function Glyph({ size, mono = false }: { size: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <path d={LOGO_PATHS.leafBig} fill={mono ? "#ffffff" : LOGO_COLORS.leafLight} />
      <path d={LOGO_PATHS.leafSmall} fill={mono ? "#ffffff" : LOGO_COLORS.orange} />
      <rect
        x={LOGO_PATHS.rim.x}
        y={LOGO_PATHS.rim.y}
        width={LOGO_PATHS.rim.width}
        height={LOGO_PATHS.rim.height}
        rx={LOGO_PATHS.rim.rx}
        fill="#ffffff"
      />
      <path d={LOGO_PATHS.bowl} fill="#ffffff" />
    </svg>
  );
}

export function renderAppIcon(size: number, variant: IconVariant = "any"): ImageResponse {
  if (variant === "badge") {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Glyph size={Math.round(size * 0.9)} mono />
        </div>
      ),
      { width: size, height: size },
    );
  }

  const maskable = variant === "maskable";
  // Maskable icons must keep the glyph inside the central 80 % circle.
  const glyph = Math.round(size * (maskable ? 0.58 : 0.7));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(135deg, #1fa75a 0%, ${LOGO_COLORS.greenDark} 100%)`,
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
        }}
      >
        <div style={{ display: "flex", marginTop: Math.round(size * 0.02) }}>
          <Glyph size={glyph} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
