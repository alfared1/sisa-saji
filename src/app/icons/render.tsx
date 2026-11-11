/**
 * Shared renderer for the generated PNG app icons (next/og ImageResponse).
 * Same mark as <LogoMark /> (src/components/common/logo.tsx).
 *
 *  - "any":      rounded deep-green tile with the tudung saji mark
 *  - "maskable": full-bleed green square, mark inside the 80 % safe zone
 *  - "badge":    white mark on transparent (Android status-bar badge)
 */
import { ImageResponse } from "next/og";
import { LOGO_COLORS, LogoGlyph } from "@/components/common/logo";

export type IconVariant = "any" | "maskable" | "badge";

function Glyph({ size, mono = false }: { size: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <LogoGlyph mono={mono} />
    </svg>
  );
}

export function renderAppIcon(size: number, variant: IconVariant = "any"): ImageResponse {
  if (variant === "badge") {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Glyph size={size} mono />
        </div>
      ),
      { width: size, height: size },
    );
  }

  const maskable = variant === "maskable";
  // The glyph is drawn for a full 64 px tile; maskable icons shrink it into the central 80 % circle.
  const glyph = Math.round(size * (maskable ? 0.8 : 1));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: LOGO_COLORS.green,
          borderRadius: maskable ? 0 : Math.round((size * 15) / 64),
        }}
      >
        <Glyph size={glyph} />
      </div>
    ),
    { width: size, height: size },
  );
}
