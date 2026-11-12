"use client";

import { ListSkeleton } from "@/components/common/list-skeleton";
import { MerchantShell } from "@/components/shell/merchant-shell";
import type { SessionUser } from "@/lib/contracts";

const DEMO_USER: SessionUser = {
  id: "00000000-0000-0000-0000-000000000000",
  role: "MERCHANT",
  full_name: "Euis Kurniasih",
  email: "demo.mitra@sisasaji.test",
  phone_number: "+6281300000001",
  campus_or_area: null,
  default_lat: null,
  default_lng: null,
  badge_tier: "SURPLUS_ROOKIE",
  loyalty_points: 0,
  merchant_id: null,
  merchant_slug: null,
  is_demo: true,
};

/** MerchantShell rendered as if on /merchant/dashboard (dev gallery). */
export function MerchantShellPreview() {
  return (
    <MerchantShell user={DEMO_USER} previewPathname="/merchant/dashboard">
      <div className="space-y-4 p-4 lg:p-8">
        <h1 className="text-2xl font-bold">Dasbor</h1>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {["Pendapatan hari ini", "Pesanan selesai", "Menunggu diambil", "Pangan diselamatkan"].map((t) => (
            <div key={t} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <p className="text-xs text-muted-foreground">{t}</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums">—</p>
            </div>
          ))}
        </div>
        <ListSkeleton count={3} variant="row" className="rounded-2xl bg-card px-4 ring-1 ring-border" />
      </div>
    </MerchantShell>
  );
}
