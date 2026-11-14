import type { Metadata } from "next";
import { DiscoverScreen } from "@/components/customer/discover/discover-screen";

export const metadata: Metadata = {
  title: "Cari Makanan Surplus",
  description:
    "Makan malam kenyang mulai Rp 10.000 dari warung terdekat. Isi menu jelas, porsi normal, ambil sendiri sebelum tutup.",
};

export default function DiscoverPage() {
  return <DiscoverScreen />;
}
