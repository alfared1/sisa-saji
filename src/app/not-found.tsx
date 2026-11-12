import type { Metadata } from "next";
import Link from "next/link";
import { SoupIcon } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Halaman tidak ditemukan",
};

export default function NotFound() {
  return (
    <div className="app-backdrop min-h-dvh">
      <main className="safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10">
        <header className="flex h-16 items-center">
          <Link href="/" className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Logo />
          </Link>
        </header>
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="relative">
            <span className="relative inline-flex size-24 items-center justify-center rounded-3xl bg-card text-deal shadow-card ring-1 ring-border">
              <SoupIcon className="size-11" />
            </span>
            <span className="absolute -top-2 -right-3 rounded-full bg-foreground px-2.5 py-1 text-xs font-black text-background shadow-soft">
              404
            </span>
          </div>
          <h1 className="mt-8 text-2xl font-bold">Yah, porsinya sudah habis</h1>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Halaman yang kamu cari tidak ditemukan atau sudah dipindahkan. Masih banyak makanan surplus lain yang
            menunggu diselamatkan!
          </p>
          <div className="mt-8 grid w-full max-w-xs gap-2">
            <Button asChild className="h-12 rounded-xl text-base font-semibold">
              <Link href="/discover">
                Cari makanan surplus
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-xl font-semibold">
              <Link href="/welcome">
                Ke halaman utama
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
