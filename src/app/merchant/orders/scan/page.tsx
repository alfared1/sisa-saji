import type { Metadata } from "next";
import { PickupScanView } from "@/components/merchant/scan/scan-view";

export const metadata: Metadata = { title: "Scan Pengambilan" };

export default function PickupScanPage() {
  return <PickupScanView />;
}
