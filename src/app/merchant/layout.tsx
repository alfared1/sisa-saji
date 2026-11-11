import type { Metadata } from "next";
import { DemoNotice } from "@/components/common/demo-notice";
import { MerchantGuard } from "@/components/shell/merchant-guard";

export const metadata: Metadata = {
  title: { default: "Mitra Warung", template: "%s · Mitra Sisa-Saji" },
};

/** Merchant area: client auth/onboarding guard + responsive MerchantShell. */
export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return (
    <MerchantGuard>
      <DemoNotice audience="mitra" className="lg:mx-6 lg:mt-4 lg:rounded-xl" />
      {children}
    </MerchantGuard>
  );
}
