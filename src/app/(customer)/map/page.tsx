import type { Metadata } from "next";
import { MapScreen } from "@/components/customer/map/map-screen";

export const metadata: Metadata = {
  title: "Peta Surplus",
  description: "Radar warung dengan porsi surplus dalam radius 2 km dari kampusmu.",
};

export default function MapPage() {
  return <MapScreen />;
}
