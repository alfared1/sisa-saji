import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { MerchantMenusView } from "@/components/merchant/menus/menus-view";

export const metadata: Metadata = { title: "Menu" };
/** Rendered behind the client MerchantGuard (session splash), so never instant. */
export const instant = false;

export default function MerchantMenusPage() {
  return (
    <Suspense fallback={<ListSkeleton count={3} className="p-4 lg:p-8" />}>
      <MerchantMenusView />
    </Suspense>
  );
}
