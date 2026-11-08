import type { Metadata } from "next";
import { MerchantAnalyticsView } from "@/components/merchant/analytics/analytics-view";

export const metadata: Metadata = { title: "Analitik" };

export default function MerchantAnalyticsPage() {
  return <MerchantAnalyticsView />;
}
