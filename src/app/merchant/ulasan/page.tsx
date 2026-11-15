import type { Metadata } from "next";
import { MerchantReviewsView } from "@/components/merchant/reviews/reviews-view";

export const metadata: Metadata = { title: "Ulasan" };

export default function MerchantReviewsPage() {
  return <MerchantReviewsView />;
}
