import type { Metadata } from "next";
import { PilotResultsView } from "./pilot-results-view";

export const metadata: Metadata = {
  title: "Hasil Uji Coba",
  description:
    "Hasil nyata uji coba Sisa-Saji di warung sungguhan: porsi makanan yang diambil pembeli dan diverifikasi warung, tanpa data demo.",
};

export default function PilotResultsPage() {
  return <PilotResultsView />;
}
