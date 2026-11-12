"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon, ShoppingBagIcon, StoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDemoLogin } from "@/hooks/use-demo-login";
import type { DemoRole } from "@/lib/demo-accounts";
import { cn } from "@/lib/utils";

const TARGET: Record<DemoRole, string> = { CUSTOMER: "/discover", MERCHANT: "/merchant/dashboard" };

/**
 * One tap into the seeded demo buyer or demo warung (POST /auth/demo). When the app is
 * not running on demo data the buttons fall back to the normal login.
 */
export function DemoLoginButtons({ demo, className }: { demo: boolean; className?: string }) {
  const router = useRouter();
  const login = useDemoLogin((_user, role) => router.push(TARGET[role]));

  const buttons = [
    { role: "CUSTOMER" as const, label: "Coba sebagai pembeli", icon: ShoppingBagIcon, primary: true },
    { role: "MERCHANT" as const, label: "Coba sebagai warung", icon: StoreIcon, primary: false },
  ];

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row", className)}>
      {buttons.map(({ role, label, icon: Icon, primary }) =>
        demo ? (
          <Button
            key={role}
            type="button"
            variant={primary ? "default" : "outline"}
            className="h-12 rounded-xl px-5 text-base font-semibold"
            disabled={login.isPending}
            onClick={() => login.mutate(role)}
          >
            {login.isPending && login.variables === role ? <Loader2Icon className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
            {label}
          </Button>
        ) : (
          <Button key={role} asChild variant={primary ? "default" : "outline"} className="h-12 rounded-xl px-5 text-base font-semibold">
            <Link href={role === "MERCHANT" ? "/auth/login?role=MERCHANT" : "/discover"}>
              <Icon aria-hidden />
              {label}
            </Link>
          </Button>
        ),
      )}
    </div>
  );
}
