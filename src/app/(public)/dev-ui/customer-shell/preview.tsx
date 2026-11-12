"use client";

import { CategoryChips } from "@/components/common/category-chips";
import { ImpactStat } from "@/components/common/impact-stat";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { LocationPill } from "@/components/common/location-pill";
import { CustomerShell, ShellHeader } from "@/components/shell/customer-shell";

/** CustomerShell rendered as if on /discover (dev gallery). */
export function CustomerShellPreview() {
  return (
    <CustomerShell previewPathname="/discover">
      <ShellHeader>
        <LocationPill />
      </ShellHeader>
      <div className="space-y-5 px-4 pt-4">
        <ImpactStat foodGrams={4200} co2Grams={10500} />
        <CategoryChips value={null} onChange={() => undefined} />
        <h2 className="text-lg font-bold">Hampir habis & diskon tertinggi</h2>
        <ListSkeleton count={4} />
      </div>
    </CustomerShell>
  );
}
