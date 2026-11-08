import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevGallery } from "./dev-gallery";

export const metadata: Metadata = {
  title: "Galeri Komponen (dev)",
  robots: { index: false },
};

/** Component gallery for design QA. Development only. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevGallery />;
}
