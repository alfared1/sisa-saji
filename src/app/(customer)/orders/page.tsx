import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { OrdersScreen } from "@/components/customer/orders/orders-screen";

export const metadata: Metadata = {
  title: "Pesanan",
  description: "Tiket pengambilan aktif dan riwayat pesanan Sisa-Saji.",
};

export default function OrdersPage() {
  return (
    <Suspense fallback={<ListSkeleton className="px-4 pt-24" count={3} />}>
      <OrdersScreen />
    </Suspense>
  );
}
