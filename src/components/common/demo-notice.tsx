import { InfoIcon } from "lucide-react";
import { isDemoData } from "@/lib/env";
import { cn } from "@/lib/utils";
import { DemoNoticeHeight } from "./demo-notice-height";

/**
 * One honest line at the top of the app on demo deployments: the warung,
 * ratings, "Mitra Terverifikasi" badges and payments are sample data.
 * Server component, so the flag never ships as client config. Its height is
 * published as `--demo-notice-h` (DemoNoticeHeight) so full-height screens
 * such as /map stay clear of the tab bar.
 */
export function DemoNotice({ audience, className }: { audience: "pembeli" | "mitra"; className?: string }) {
  if (!isDemoData()) return null;
  return (
    <aside
      aria-label="Mode demo"
      className={cn(
        "flex items-start gap-2 bg-warning-soft px-4 py-2 text-xs leading-snug text-amber-900 dark:text-amber-100",
        className,
      )}
    >
      <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      <p>
        <b className="font-semibold">Mode demo.</b>{" "}
        {audience === "pembeli"
          ? "Warung, rating, dan pembayaran di sini contoh, kecuali warung berlabel “Warung uji coba” yang sungguhan dan dibayar langsung di tempat."
          : "Pesanan dan pembayaran di sini hanya contoh. Saldo warung tidak bisa dicairkan. Warung uji coba menerima bayaran langsung dari pembeli."}
      </p>
      <DemoNoticeHeight />
    </aside>
  );
}
