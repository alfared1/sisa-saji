import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const DESCRIPTION =
  "Selamatkan makanan surplus dari warung di sekitar kampus dengan harga hemat hingga 70%. Pesan, bayar QRIS, ambil sendiri — kurang dari 3 menit.";

export const metadata: Metadata = {
  title: {
    default: "Sisa-Saji — Selamatkan Makanan, Hemat Uang",
    template: "%s · Sisa-Saji",
  },
  description: DESCRIPTION,
  applicationName: "Sisa-Saji",
  keywords: ["food waste", "makanan surplus", "diskon makanan", "warung", "mahasiswa", "PWA"],
  appleWebApp: {
    capable: true,
    title: "Sisa-Saji",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: "Sisa-Saji",
    title: "Sisa-Saji — Selamatkan Makanan, Hemat Uang",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1a14" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={jakarta.variable} suppressHydrationWarning>
      <body className="min-h-dvh">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
