import type { Metadata } from "next";
import { DiscoverScreen } from "@/components/customer/discover/discover-screen";

export const metadata: Metadata = {
  title: "Cari Makanan Surplus",
  description: "Porsi surplus warung di sekitar kampus dengan diskon hingga 70%. Ambil sendiri malam ini.",
};

export default function DiscoverPage() {
  return <DiscoverScreen />;
}
