import type { Metadata } from "next";
import { MapScreen } from "@/components/customer/map/map-screen";

export const metadata: Metadata = {
  title: "Peta Surplus",
  description: "Semua warung Sisa-Saji di seluruh Indonesia, lalu porsi surplus dalam radius 2 km dari kampus atau lokasimu.",
};

export default function MapPage() {
  return <MapScreen />;
}
