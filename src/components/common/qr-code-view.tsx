"use client";

import type { ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";

/**
 * Large, high-contrast QR (always black on white, even in dark mode, so
 * scanners and QRIS apps read it reliably).
 */
export function QrCodeView({
  value,
  size = 232,
  caption,
  label = "Kode QR",
  level = "M",
  className,
}: {
  value: string;
  size?: number;
  caption?: ReactNode;
  label?: string;
  level?: "L" | "M" | "Q" | "H";
  className?: string;
}) {
  return (
    <figure className={cn("flex flex-col items-center gap-3", className)}>
      <div className="rounded-3xl bg-white p-4 shadow-card ring-1 ring-black/5">
        <QRCodeSVG
          value={value}
          size={size}
          level={level}
          bgColor="#ffffff"
          fgColor="#0b1410"
          marginSize={0}
          title={label}
          role="img"
          aria-label={label}
          style={{ width: "100%", height: "auto", maxWidth: size }}
        />
      </div>
      {caption && <figcaption className="text-center text-sm text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
