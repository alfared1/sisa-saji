import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/merchant/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Daftar sebagai Penjual" };

export default function MerchantOnboardingPage() {
  return <OnboardingWizard />;
}
