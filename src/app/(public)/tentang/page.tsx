import type { Metadata } from "next";
import { AboutView } from "./about-view";

export const metadata: Metadata = {
  title: "Tentang Sisa-Saji",
  description:
    "Sisa-Saji menjual porsi surplus warung makan menjelang tutup kepada pembeli di sekitarnya: cara kerja, dampak yang dihitung, teknologi, model bisnis, dan SDGs.",
};

export default function AboutPage() {
  return <AboutView />;
}
