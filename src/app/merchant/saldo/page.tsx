import type { Metadata } from "next";
import { MerchantWalletView } from "@/components/merchant/wallet/wallet-view";

export const metadata: Metadata = { title: "Saldo" };

export default function MerchantWalletPage() {
  return <MerchantWalletView />;
}
