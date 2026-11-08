import { redirect } from "next/navigation";

/**
 * Redirect-only segment: it never renders UI, so instant-navigation validation has nothing to check
 * (it would only report the NEXT_REDIRECT as "an error prevented the target segment from rendering").
 */
export const instant = false;

/** /merchant → the command center (the layout guard handles login & onboarding). */
export default function MerchantIndexPage() {
  redirect("/merchant/dashboard");
}
