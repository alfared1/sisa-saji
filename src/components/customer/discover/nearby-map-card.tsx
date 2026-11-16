"use client";

/**
 * Wide screens only: "Peta sekitar" beside the Beranda list. The same warung as the list (it is
 * fed the filtered merchants), drawn on the real map within the search radius; tapping a pin
 * opens that warung, "Buka Peta" opens the full map.
 */
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SurplusMap } from "@/components/map/surplus-map";
import { markerFromMerchant } from "@/components/map/types";
import type { NearbyResponse } from "@/lib/contracts";
import { cn } from "@/lib/utils";

type Merchant = NearbyResponse["merchants"][number];

export function NearbyMapCard({
  merchants,
  center,
  radiusM,
  className,
}: {
  merchants: Merchant[];
  center: { lat: number; lng: number };
  radiusM: number;
  className?: string;
}) {
  const router = useRouter();
  const markers = useMemo(() => merchants.map(markerFromMerchant), [merchants]);
  const slugById = useMemo(() => new Map(merchants.map((m) => [m.id, m.slug])), [merchants]);

  return (
    <section aria-labelledby="peta-sekitar" className={cn("rounded-3xl bg-card p-4 ring-1 ring-border", className)}>
      <h2 id="peta-sekitar" className="font-bold">
        Peta sekitar
      </h2>
      <div className="mt-3 h-80 overflow-hidden rounded-2xl ring-1 ring-border">
        <SurplusMap
          center={center}
          radiusM={radiusM}
          markers={markers}
          showRecenter={false}
          onMarkerClick={(id) => {
            const slug = slugById.get(id);
            if (slug) router.push(`/warung/${slug}`);
          }}
          className="h-full"
        />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Ketuk pin untuk membuka warungnya.</p>
      <Link
        href="/map"
        className="mt-3 flex h-11 items-center justify-center rounded-xl border border-input text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Buka Peta
      </Link>
    </section>
  );
}
