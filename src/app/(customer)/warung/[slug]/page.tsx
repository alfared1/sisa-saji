import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { MerchantScreen } from "@/components/customer/warung/merchant-screen";

/** The customer layout reads usePathname() for its tab bar; allow this dynamic route to block on it. */
export const instant = false;

export const metadata: Metadata = {
  title: "Warung",
  description: "Menu surplus malam ini, harga turun otomatis menjelang tutup. Pesan & ambil sendiri.",
};

async function WarungLoader({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <MerchantScreen slug={decodeURIComponent(slug)} />;
}

export default function WarungPage({ params }: PageProps<"/warung/[slug]">) {
  return (
    <Suspense fallback={<ListSkeleton className="px-4 pt-20" count={4} />}>
      <WarungLoader params={params} />
    </Suspense>
  );
}
