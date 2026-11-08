import type { Metadata } from "next";
import { MerchantGuard } from "@/components/shell/merchant-guard";

export const metadata: Metadata = {
  title: { default: "Mitra Warung", template: "%s · Mitra Sisa-Saji" },
};

/** Merchant area: client auth/onboarding guard + responsive MerchantShell. */
export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <MerchantGuard>{children}</MerchantGuard>;
}
