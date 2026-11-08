import type { Metadata } from "next";
import { WelcomeView } from "./welcome-view";

export const metadata: Metadata = {
  title: "Selamat Datang",
  description:
    "Sisa-Saji menghubungkan warung di sekitar kampus dengan mahasiswa untuk menyelamatkan makanan surplus menjelang jam tutup — hemat hingga 70%.",
};

export default function WelcomePage() {
  return <WelcomeView />;
}
