import type { Metadata } from "next";
import { MerchantSettingsView } from "@/components/merchant/settings/settings-view";

export const metadata: Metadata = { title: "Pengaturan Warung" };

export default function MerchantSettingsPage() {
  return <MerchantSettingsView />;
}
