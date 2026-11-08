import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { QUICK_ORDER_PARAM } from "@/components/customer/quick-order/quick-order-param";
import { MerchantScreen } from "@/components/customer/warung/merchant-screen";

export const metadata: Metadata = {
  title: "Warung",
  description: "Menu surplus malam ini, harga turun otomatis menjelang tutup. Pesan & ambil sendiri.",
};

async function WarungLoader({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  // ?order=<batchId> (after login from a quick order) reopens that menu's sheet.
  const order = sp[QUICK_ORDER_PARAM];
  return <MerchantScreen slug={decodeURIComponent(slug)} openBatchId={typeof order === "string" ? order : null} />;
}

export default function WarungPage({ params, searchParams }: PageProps<"/warung/[slug]">) {
  return (
    <Suspense fallback={<ListSkeleton className="px-4 pt-20" count={4} />}>
      <WarungLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}
