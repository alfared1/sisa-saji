import type { Metadata } from "next";
import { MerchantDashboardView } from "@/components/merchant/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dasbor" };
/** The client MerchantGuard renders a splash until the session loads, so this segment is never instant. */
export const instant = false;

export default function MerchantDashboardPage() {
  return <MerchantDashboardView />;
}
