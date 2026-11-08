import type { Metadata } from "next";
import { MerchantOrdersView } from "@/components/merchant/orders/orders-view";

export const metadata: Metadata = { title: "Pesanan" };

export default function MerchantOrdersPage() {
  return <MerchantOrdersView />;
}
