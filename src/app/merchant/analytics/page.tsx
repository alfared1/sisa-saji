import type { Metadata } from "next";
import { MerchantAnalyticsView } from "@/components/merchant/analytics/analytics-view";

export const metadata: Metadata = { title: "Analitik" };
/** Rendered behind the client MerchantGuard (session splash), so never instant. */
export const instant = false;

export default function MerchantAnalyticsPage() {
  return <MerchantAnalyticsView />;
}
