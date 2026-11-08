import type { Metadata } from "next";
import { MerchantSettingsView } from "@/components/merchant/settings/settings-view";

export const metadata: Metadata = { title: "Pengaturan Warung" };
/** Rendered behind the client MerchantGuard (session splash), so never instant. */
export const instant = false;

export default function MerchantSettingsPage() {
  return <MerchantSettingsView />;
}
