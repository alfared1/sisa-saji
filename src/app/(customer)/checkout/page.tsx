import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/customer/checkout/checkout-screen";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Ringkasan pesanan, cara ambil, voucher, dan pembayaran: QRIS atau tunai di warung.",
};

export default function CheckoutPage() {
  return <CheckoutScreen />;
}
