import { redirect } from "next/navigation";

/** Rendered behind the client MerchantGuard (session splash), so never instant. */
export const instant = false;

/** /merchant → the command center (the layout guard handles login & onboarding). */
export default function MerchantIndexPage() {
  redirect("/merchant/dashboard");
}
