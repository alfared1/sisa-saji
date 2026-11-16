import type { Metadata } from "next";
import { MerchantMoreView } from "@/components/merchant/more/more-view";

export const metadata: Metadata = { title: "Lainnya" };

export default function MerchantMorePage() {
  return <MerchantMoreView />;
}
