import type { Metadata } from "next";
import { WelcomeView } from "./welcome-view";

export const metadata: Metadata = {
  title: "Selamat Datang",
  description:
    "Makan malam kenyang mulai Rp 10.000 dari warung terdekat sebelum tutup. Isi menunya jelas, porsinya normal, dan kebersihannya dinilai pembeli lain. Ambil sendiri di warung dekat kos.",
};

export default function WelcomePage() {
  return <WelcomeView />;
}
