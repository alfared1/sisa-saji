import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/merchant/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Daftar Mitra Warung" };
/** Rendered behind the client MerchantGuard (session splash), so never instant. */
export const instant = false;

export default function MerchantOnboardingPage() {
  return <OnboardingWizard />;
}
