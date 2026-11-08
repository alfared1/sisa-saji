"use client";

/**
 * Customer app frame: centered mobile container (max-w-md) on a soft brand
 * backdrop, content, a slot above the tab bar for <FloatingCartBar />, and the
 * bottom tab bar (Beranda · Peta · Pesanan · Dampak · Akun).
 *
 * The tab bar shows on the five tab roots only; deeper screens (warung,
 * checkout, order detail) get the full height. The cart bar shows where
 * shopping happens (discover, map, warung).
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, LeafIcon, MapIcon, ReceiptTextIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import { FloatingCartBar } from "@/components/common/floating-cart-bar";
import { cn } from "@/lib/utils";
import { selectCartCount, useCartStore } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { useTicketsStore } from "@/stores/tickets";
import { isCustomerTabRoot, showsCartBar } from "./nav-logic";

export type ShellTab = { href: string; label: string; icon: LucideIcon };

export const CUSTOMER_TABS: readonly ShellTab[] = [
  { href: "/discover", label: "Beranda", icon: HomeIcon },
  { href: "/map", label: "Peta", icon: MapIcon },
  { href: "/orders", label: "Pesanan", icon: ReceiptTextIcon },
  { href: "/impact", label: "Dampak", icon: LeafIcon },
  { href: "/profile", label: "Akun", icon: UserRoundIcon },
];

export { isCustomerTabRoot } from "./nav-logic";

function isActiveTab(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CustomerShell({
  children,
  previewPathname,
}: {
  children: ReactNode;
  /** Dev gallery only: render as if at this path. */
  previewPathname?: string;
}) {
  const routerPathname = usePathname();
  const pathname = previewPathname ?? routerPathname ?? "/";
  const hydrated = useStoresHydrated();
  const cartCount = useCartStore(selectCartCount);
  const showNav = isCustomerTabRoot(pathname);
  const showCart = hydrated && cartCount > 0 && showsCartBar(pathname);

  return (
    <div className="app-backdrop min-h-dvh">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background sm:shadow-float sm:ring-1 sm:ring-border/70">
        <main
          id="konten"
          className={cn("flex min-w-0 flex-1 flex-col", showNav ? "pb-nav" : "safe-bottom", showCart && "mb-20")}
        >
          {children}
        </main>

        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md">
          {showCart && (
            <div className={cn("pointer-events-auto px-3 pb-2", !showNav && "safe-bottom")}>
              <FloatingCartBar />
            </div>
          )}
          {showNav && <CustomerBottomNav pathname={pathname} />}
        </div>
      </div>
    </div>
  );
}

function CustomerBottomNav({ pathname }: { pathname: string }) {
  const hydrated = useStoresHydrated();
  const ticketCount = useTicketsStore((s) => Object.keys(s.tickets).length);

  return (
    <nav
      aria-label="Navigasi utama"
      className="safe-bottom pointer-events-auto border-t border-border/70 bg-background/90 backdrop-blur-xl"
    >
      <ul className="grid grid-cols-5 px-1">
        {CUSTOMER_TABS.map(({ href, label, icon: Icon }) => {
          const active = isActiveTab(pathname, href);
          const badge = href === "/orders" && hydrated && ticketCount > 0 ? ticketCount : 0;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold outline-none transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "relative inline-flex h-8 w-14 items-center justify-center rounded-full transition-all group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
                    active ? "bg-brand-soft" : "group-active:bg-muted",
                  )}
                >
                  <Icon className={cn("size-5", active && "stroke-[2.4]")} aria-hidden />
                  {badge > 0 && (
                    <span className="absolute top-0 right-2 inline-flex min-w-4 items-center justify-center rounded-full bg-deal px-1 text-[10px] leading-4 font-extrabold text-deal-foreground tabular-nums ring-2 ring-background">
                      {badge}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Sticky, blurred top bar for customer screens (safe-area aware). */
export function ShellHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        "safe-top sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-xl",
        className,
      )}
    >
      <div className="px-4 py-3">{children}</div>
    </header>
  );
}
