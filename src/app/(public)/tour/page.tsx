import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/common/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { TourView } from "@/components/tour/tour-view";

export const metadata: Metadata = {
  title: "Tur Aplikasi",
  description:
    "Kenali Sisa-Saji dalam satu menit: cari makan malam hemat dari warung dekat kos, kunci porsi, bayar QRIS atau tunai di warung, lalu ambil sendiri. Untuk mitra: publikasikan surplus dalam 60 detik.",
};

/** Static shell while the client reads ?peran / ?langkah (useSearchParams needs a Suspense boundary). */
function TourFallback() {
  return (
    <div className="app-backdrop flex min-h-dvh flex-col" aria-busy="true">
      <div className="safe-top mx-auto w-full max-w-md px-4 md:max-w-5xl md:px-8 lg:max-w-6xl">
        <div className="flex h-14 items-center md:h-16">
          <Logo />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 md:grid md:max-w-5xl md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center md:gap-x-10 md:py-8 lg:pt-2 lg:pb-8 md:px-8 lg:max-w-6xl lg:gap-x-16">
        <div className="contents md:block md:space-y-4">
          <Skeleton className="h-12 rounded-xl md:h-[52px] md:w-[22rem]" />
          <div className="mt-5 hidden space-y-3 md:block">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-4/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
        <Skeleton className="mt-3 h-[clamp(15rem,calc(100svh-28rem),23rem)] rounded-3xl min-[380px]:h-[clamp(16rem,calc(100svh-26.5rem),23rem)] md:mt-0 md:h-[min(40rem,calc(100svh-10rem))] lg:h-[min(38rem,calc(100svh-7.5rem))]" />
        <div className="mt-4 space-y-3 md:hidden">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}

export default function TourPage() {
  return (
    <Suspense fallback={<TourFallback />}>
      <TourView />
    </Suspense>
  );
}
