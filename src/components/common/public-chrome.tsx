"use client";

/**
 * Header and footer shared by the public pages (/welcome, /tentang, /uji-coba): the same
 * navigation everywhere, a one-line "Mode demo" strip while the app runs on demo data, and a
 * footer that carries the photo credit line.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/common/logo";
import { ThemeToggle } from "@/components/common/theme-switcher";
import { useGlobalStats } from "@/hooks/use-global-stats";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/welcome#cara-kerja", label: "Cara kerja", wideOnly: true },
  { href: "/welcome#untuk-warung", label: "Untuk warung", wideOnly: true },
  { href: "/tentang", label: "Tentang", wideOnly: false },
  { href: "/uji-coba", label: "Uji coba", wideOnly: true },
] as const;

export function PublicHeader({ className }: { className?: string }) {
  const pathname = usePathname();
  const stats = useGlobalStats();
  return (
    <>
      {stats.data?.is_demo_data && (
        <p className="bg-warning-soft px-4 py-1.5 text-center text-xs font-semibold text-amber-900 dark:text-amber-100">
          Mode demo: data contoh, pembayaran disimulasikan
        </p>
      )}
      <header className={cn("safe-top mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 lg:px-8", className)}>
        <Link href="/welcome" aria-label="Sisa-Saji, halaman depan" className="mr-auto rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Logo />
        </Link>
        <nav aria-label="Halaman publik" className="flex items-center">
          {NAV.map(({ href, label, wideOnly }) => {
            const current = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "min-h-11 items-center rounded-xl px-2.5 text-sm font-semibold outline-none hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50 lg:px-3",
                  wideOnly ? "hidden md:inline-flex" : "inline-flex",
                  current ? "text-primary underline decoration-2 underline-offset-8" : "text-foreground/85",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <ThemeToggle className="size-10" />
        <Link
          href="/auth/login"
          className="inline-flex h-11 items-center rounded-xl border border-input bg-card px-4 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Masuk
        </Link>
      </header>
    </>
  );
}

const FOOTER_LINKS = [
  { href: "/tentang", label: "Tentang" },
  { href: "/uji-coba", label: "Warung uji coba" },
  { href: "/auth/login?role=MERCHANT", label: "Daftarkan warung" },
  { href: "/auth/login", label: "Masuk" },
] as const;

export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <nav aria-label="Tautan bawah" className="flex flex-wrap gap-x-5 gap-y-1">
            {FOOTER_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Foto menu pengganti berasal dari Wikimedia Commons. Nama pembuat dan lisensinya ada di{" "}
          <Link href="/tentang#sumber" className="font-semibold text-primary underline underline-offset-2">
            bagian Sumber
          </Link>{" "}
          halaman Tentang.
        </p>
      </div>
    </footer>
  );
}
