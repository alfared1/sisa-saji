import type { Metadata } from "next";
import { PickupScanView } from "@/components/merchant/scan/scan-view";

export const metadata: Metadata = { title: "Scan Pengambilan" };
/** Rendered behind the client MerchantGuard (session splash), so never instant. */
export const instant = false;

export default function PickupScanPage() {
  return <PickupScanView />;
}
