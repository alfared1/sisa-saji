import type { Metadata } from "next";
import { Suspense } from "react";
import { SurplusPublisherView } from "@/components/merchant/publisher/publisher-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Publikasi Surplus" };

export default function SurplusNewPage() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-[70dvh] rounded-3xl lg:m-8" />}>
      <SurplusPublisherView />
    </Suspense>
  );
}
