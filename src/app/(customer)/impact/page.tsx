import type { Metadata } from "next";
import { ImpactScreen } from "@/components/customer/impact/impact-screen";

export const metadata: Metadata = {
  title: "Dampak",
  description: "Kg makanan yang kamu selamatkan, emisi CO₂e yang dicegah, dan level Surplus Hero.",
};

export default function ImpactPage() {
  return <ImpactScreen />;
}
