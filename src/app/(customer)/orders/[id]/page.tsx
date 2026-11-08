import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { OrderDetailScreen } from "@/components/customer/orders/order-detail-screen";

/** The customer layout reads usePathname() for its tab bar; allow this dynamic route to block on it. */
export const instant = false;

export const metadata: Metadata = {
  title: "Detail Pesanan",
  description: "Pembayaran QRIS, tiket pengambilan, dan dampak pesananmu.",
};

async function OrderLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetailScreen id={id} />;
}

export default function OrderDetailPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton className="px-4 pt-20" count={3} />}>
      <OrderLoader params={params} />
    </Suspense>
  );
}
