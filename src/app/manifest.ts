import type { MetadataRoute } from "next";

/** Web App Manifest (/manifest.webmanifest). Icons are generated in src/app/icons. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Sisa-Saji: Makan Malam Hemat dari Warung Terdekat",
    short_name: "Sisa-Saji",
    description:
      "Makan malam kenyang mulai Rp 10.000 dari warung terdekat sebelum tutup. Menu jelas, porsi normal, ambil sendiri.",
    lang: "id",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#138a47",
    background_color: "#fbf8f3",
    categories: ["food", "lifestyle", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Cari makan malam hemat",
        short_name: "Cari",
        url: "/discover",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Peta surplus",
        short_name: "Peta",
        url: "/map",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Pesanan saya",
        short_name: "Pesanan",
        url: "/orders",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
