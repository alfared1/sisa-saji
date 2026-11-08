import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/customer/checkout/checkout-screen";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Ringkasan pesanan, waktu ambil, voucher, dan pembayaran QRIS.",
};

export default function CheckoutPage() {
  return <CheckoutScreen />;
}
