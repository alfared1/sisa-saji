import type { Metadata } from "next";
import { MerchantDashboardView } from "@/components/merchant/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dasbor" };

export default function MerchantDashboardPage() {
  return <MerchantDashboardView />;
}
