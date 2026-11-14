import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { THEME_COLORS, themeColorBootScript } from "@/lib/theme";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const TITLE = "Sisa-Saji: Makan Malam Hemat dari Warung Terdekat";
const DESCRIPTION =
  "Makan malam kenyang mulai Rp 10.000 dari warung terdekat sebelum tutup. Menu jelas, porsi normal, ambil sendiri.";

export const metadata: Metadata = {
  title: {
    default: TITLE,
    template: "%s · Sisa-Saji",
  },
  description: DESCRIPTION,
  applicationName: "Sisa-Saji",
  keywords: [
    "makan murah mahasiswa Bogor",
    "makan malam hemat",
    "diskon makanan",
    "warung",
    "mahasiswa",
    "food waste",
    "makanan surplus",
    "PWA",
  ],
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
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Right for "Sistem" (the default). A manual Terang/Gelap choice repoints both tags:
  // before first paint (themeColorBootScript below) and on every change (ThemeColorSync).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={jakarta.variable} suppressHydrationWarning>
      <body className="min-h-dvh">
        {/* Runs before first paint; the theme-color tags are already parsed in <head>. */}
        <script dangerouslySetInnerHTML={{ __html: themeColorBootScript() }} />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
