"use client";

/**
 * Merchant (Mitra Warung) frame.
 *  - Mobile/tablet portrait: deep green top bar ("Mode warung" or "Kasir", warung name, open
 *    status, theme, account) so the role is clear from the frame, and five bottom tabs: Dasbor,
 *    Pesanan, Scan (emphasised), Menu, Lainnya. A cashier gets two: Pesanan and Scan.
 *  - Desktop/cashier (lg+): left sidebar (theme toggle beside the logo) + wide
 *    content area.
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3Icon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  ScanLineIcon,
  SettingsIcon,
  ShoppingBagIcon,
  StoreIcon,
  UtensilsCrossedIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Logo } from "@/components/common/logo";
import { ThemeToggle } from "@/components/common/theme-switcher";
import { VerifiedBadge } from "@/components/common/verified-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api/client";
import type { MerchantMeResponse, SessionUser } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { activeNavHref, CASHIER_PATHS } from "./nav-logic";

export type MerchantNavItem = { href: string; label: string; icon: LucideIcon; emphasis?: boolean };

/** Desktop sidebar: the work of the evening. */
export const MERCHANT_NAV: readonly MerchantNavItem[] = [
  { href: "/merchant/dashboard", label: "Dasbor", icon: LayoutDashboardIcon },
  { href: "/merchant/surplus/new", label: "Publikasi", icon: MegaphoneIcon },
  { href: "/merchant/orders", label: "Pesanan", icon: ClipboardListIcon },
  { href: "/merchant/orders/scan", label: "Scan", icon: ScanLineIcon, emphasis: true },
  { href: "/merchant/menus", label: "Menu", icon: UtensilsCrossedIcon },
  { href: "/merchant/analytics", label: "Analitik", icon: BarChart3Icon },
];

/** Owner pages opened less often: the desktop sidebar's second group and the Lainnya tab. */
export const MERCHANT_MORE_NAV: readonly MerchantNavItem[] = [
  { href: "/merchant/saldo", label: "Saldo", icon: WalletIcon },
  { href: "/merchant/ulasan", label: "Ulasan", icon: MessageSquareTextIcon },
  { href: "/merchant/settings", label: "Pengaturan", icon: SettingsIcon },
];

export const MERCHANT_MORE_PATH = "/merchant/lainnya";

/** Phone bottom tabs: five places, the rest sits behind Lainnya. */
export const MERCHANT_TABS: readonly MerchantNavItem[] = [
  { href: "/merchant/dashboard", label: "Dasbor", icon: LayoutDashboardIcon },
  { href: "/merchant/orders", label: "Pesanan", icon: ClipboardListIcon },
  { href: "/merchant/orders/scan", label: "Scan", icon: ScanLineIcon, emphasis: true },
  { href: "/merchant/menus", label: "Menu", icon: UtensilsCrossedIcon },
  { href: MERCHANT_MORE_PATH, label: "Lainnya", icon: MenuIcon },
];

/** Which phone tab a page belongs to: pages reached from Lainnya light Lainnya, publishing lights Dasbor. */
export function activeMerchantTab(pathname: string): string | null {
  const href = activeMerchantHref(pathname);
  if (href === "/merchant/surplus/new") return "/merchant/dashboard";
  if (href === "/merchant/analytics" || MERCHANT_MORE_NAV.some((i) => i.href === href)) return MERCHANT_MORE_PATH;
  return href;
}

export const MERCHANT_ME_QUERY_KEY = ["merchant", "me"] as const;

export function activeMerchantHref(pathname: string): string | null {
  return activeNavHref(
    pathname,
    [...MERCHANT_NAV, ...MERCHANT_MORE_NAV, { href: MERCHANT_MORE_PATH }].map((i) => i.href),
  );
}

const isCashier = (user: SessionUser | null) => Boolean(user && !user.merchant_id && user.cashier_of);
const cashierOnly = (items: readonly MerchantNavItem[]) =>
  items.filter((i) => (CASHIER_PATHS as readonly string[]).includes(i.href));

/** A cashier only sees the counter: Pesanan and Scan. */
function navFor(user: SessionUser | null): readonly MerchantNavItem[] {
  return isCashier(user) ? cashierOnly(MERCHANT_NAV) : MERCHANT_NAV;
}
function tabsFor(user: SessionUser | null): readonly MerchantNavItem[] {
  return isCashier(user) ? cashierOnly(MERCHANT_TABS) : MERCHANT_TABS;
}

/** "Buka sampai 22.00" from "22:00:00". */
export function openUntilLabel(closeTime: string | null | undefined): string {
  return closeTime ? `Buka sampai ${closeTime.slice(0, 5).replace(":", ".")}` : "Buka";
}

function useMerchantMe(enabled: boolean) {
  return useQuery({
    queryKey: MERCHANT_ME_QUERY_KEY,
    queryFn: () => api.get<MerchantMeResponse>("/merchant/me"),
    enabled,
    staleTime: 30_000,
  });
}

function StoreStatusBadge({
  isOpen,
  loading,
  className,
}: {
  isOpen: boolean | undefined;
  loading: boolean;
  className?: string;
}) {
  if (isOpen === undefined) {
    return loading ? <span className={cn("inline-block h-5 w-14 animate-pulse rounded-full bg-muted", className)} /> : null;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        isOpen ? "bg-success-soft text-primary" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", isOpen ? "bg-primary" : "bg-muted-foreground")} />
      {isOpen ? "Buka" : "Tutup"}
    </span>
  );
}

/** "Keluar" asks first, so a mistap in the account menu does not end the session mid-shift. */
export function LogoutConfirm({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { logout, isLoggingOut } = useSession();
  const router = useRouter();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !isLoggingOut && onOpenChange(o)}
      title="Keluar dari akun?"
      description="Kamu perlu masuk lagi dengan kode OTP. Pesanan dan saldo warung tetap aman."
      confirmLabel="Ya, keluar"
      cancelLabel="Batal"
      loading={isLoggingOut}
      onConfirm={() => logout().then(() => router.replace("/welcome"))}
    />
  );
}

function AccountMenu({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [confirmLogout, setConfirmLogout] = useState(false);
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl">
        <DropdownMenuLabel className="truncate">
          {user.full_name}
          <span className="block text-xs font-normal text-muted-foreground">
            {user.phone_number ?? user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.merchant_id &&
          MERCHANT_MORE_NAV.map(({ href, label, icon: Icon }) => (
            <DropdownMenuItem key={href} asChild>
              <Link href={href}>
                <Icon /> {label}
              </Link>
            </DropdownMenuItem>
          ))}
        {user.merchant_slug && (
          <DropdownMenuItem asChild>
            <Link href={`/warung/${user.merchant_slug}`}>
              <StoreIcon /> Lihat halaman warung
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/discover">
            <ShoppingBagIcon /> Ke mode pembeli
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setConfirmLogout(true)}>
          <LogOutIcon /> Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <LogoutConfirm open={confirmLogout} onOpenChange={setConfirmLogout} />
    </>
  );
}

export function MerchantShell({
  user,
  children,
  previewPathname,
}: {
  /** null while the session is still loading (optimistic frame from MerchantGuard). */
  user: SessionUser | null;
  children: ReactNode;
  /** Dev gallery only: render as if at this path. */
  previewPathname?: string;
}) {
  const routerPathname = usePathname();
  const pathname = previewPathname ?? routerPathname ?? "";
  const active = activeMerchantHref(pathname);
  // While the session loads we already ask for the warung (it is the common case).
  // Only once /auth/me confirms a warung (no 401/403 while the guard decides).
  const me = useMerchantMe(Boolean(user?.merchant_id));
  const merchant = me.data?.merchant;
  const cashierOf = user && !user.merchant_id ? user.cashier_of : null;
  const nav = navFor(user);
  const tabs = tabsFor(user);
  const activeTab = activeMerchantTab(pathname);
  const storeName =
    cashierOf?.merchant_name ?? merchant?.merchant_name ?? (me.isLoading ? "Memuat warung…" : "Warung kamu");
  const initials = (user?.full_name ?? "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="min-h-dvh bg-surface">
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/merchant/dashboard" className="outline-none">
            <Logo />
          </Link>
          <span className="ml-2 rounded-md bg-deal-soft px-1.5 py-0.5 text-[10px] font-semibold text-deal">
            Penjual
          </span>
          <ThemeToggle align="start" className="-mr-2 ml-auto size-10" />
        </div>
        <div className="mx-3 mb-3 rounded-2xl bg-card p-3 ring-1 ring-border">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-soft text-primary">
              <StoreIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{storeName}</p>
              {cashierOf ? (
                <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">Kasir</span>
              ) : (
                <StoreStatusBadge isOpen={merchant?.is_open} loading={me.isLoading} className="mt-0.5" />
              )}
            </div>
          </div>
          {merchant?.merchant_verified && <VerifiedBadge className="mt-2" />}
        </div>
        <nav aria-label="Menu penjual" className="flex-1 space-y-1 overflow-y-auto px-3">
          {nav.map(({ href, label, icon: Icon, emphasis }) => {
            const isActive = active === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className={cn("size-5", isActive && "text-primary")} />
                {label}
                {emphasis && (
                  <span className="ml-auto rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    QR
                  </span>
                )}
              </Link>
            );
          })}
          {user?.merchant_id && (
            <div className="mt-3 space-y-1 border-t border-sidebar-border pt-3">
              {MERCHANT_MORE_NAV.map(({ href, label, icon: Icon }) => {
                const isActive = active === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className={cn("size-5", isActive && "text-primary")} />
                    {label}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          {user ? (
            <AccountMenu user={user}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl p-2 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                  {initials || "M"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{user.full_name}</span>
                  <span className="block text-xs text-muted-foreground">{cashierOf ? "Kasir" : "Pemilik warung"}</span>
                </span>
              </button>
            </AccountMenu>
          ) : (
            <div className="flex items-center gap-3 p-2" aria-busy="true" aria-label="Memuat akun">
              <span className="size-9 animate-pulse rounded-full bg-muted" />
              <span className="h-4 flex-1 animate-pulse rounded bg-muted" />
            </div>
          )}
        </div>
      </aside>

      {/* ---------- Mobile top bar: deep green marks the warung's mode ---------- */}
      <header className="safe-top sticky top-0 z-30 bg-deep text-on-deep lg:hidden">
        <div className="flex h-14 items-center gap-2 pr-2 pl-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] leading-tight font-semibold text-leaf">{cashierOf ? "Kasir" : "Mode warung"}</p>
            <p className="truncate text-[15px] leading-tight font-bold">{storeName}</p>
          </div>
          {!cashierOf &&
            (merchant ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                  merchant.is_open ? "bg-leaf/16 text-leaf" : "bg-on-deep/12 text-on-deep",
                )}
              >
                <span aria-hidden className={cn("size-1.5 rounded-full", merchant.is_open ? "bg-leaf" : "bg-on-deep/70")} />
                {merchant.is_open ? openUntilLabel(merchant.operational_close_time) : "Tutup"}
              </span>
            ) : (
              me.isLoading && <span className="h-6 w-20 animate-pulse rounded-full bg-on-deep/15" aria-hidden />
            ))}
          <ThemeToggle className="size-10 text-on-deep/85 hover:bg-white/10 hover:text-on-deep aria-expanded:bg-white/10 aria-expanded:text-on-deep dark:hover:bg-white/10" />
          {user ? (
            <AccountMenu user={user}>
              <button
                type="button"
                aria-label="Akun"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-on-deep text-xs font-bold text-deep outline-none focus-visible:ring-3 focus-visible:ring-leaf"
              >
                {initials || "M"}
              </button>
            </AccountMenu>
          ) : (
            <span className="size-9 animate-pulse rounded-full bg-on-deep/15" aria-hidden />
          )}
        </div>
      </header>

      {/* ---------- Content ---------- */}
      <main id="konten" className="min-w-0 pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-8 lg:pl-64">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      {/* ---------- Mobile bottom nav ---------- */}
      <nav
        aria-label="Menu penjual"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto grid max-w-2xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map(({ href, label, icon: Icon, emphasis }) => {
            const isActive = activeTab === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group flex h-[4.25rem] flex-col items-center justify-center gap-1 text-[10.5px] font-semibold outline-none",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {emphasis ? (
                    <span
                      className={cn(
                        // -my-1: the 40 px button takes the same 32 px of layout as the other icons, so every label sits on one line.
                        "-my-1 inline-flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-card transition-transform group-active:scale-95 group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
                        isActive && "ring-4 ring-brand-soft",
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex h-8 w-11 items-center justify-center rounded-full group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
                        isActive && "bg-brand-soft",
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                    </span>
                  )}
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
