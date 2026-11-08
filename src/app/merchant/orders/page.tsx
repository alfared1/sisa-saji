import type { Metadata } from "next";
import { MerchantOrdersView } from "@/components/merchant/orders/orders-view";

export const metadata: Metadata = { title: "Pesanan" };
/** Rendered behind the client MerchantGuard (session splash), so never instant. */
export const instant = false;

export default function MerchantOrdersPage() {
  return <MerchantOrdersView />;
}
