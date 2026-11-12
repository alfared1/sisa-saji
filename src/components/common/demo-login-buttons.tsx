"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon, ShoppingBagIcon, StoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSetSessionUser } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import type { OtpVerifyResponse } from "@/lib/contracts";
import type { DemoRole } from "@/lib/demo-accounts";
import { cn } from "@/lib/utils";

const TARGET: Record<DemoRole, string> = { CUSTOMER: "/discover", MERCHANT: "/merchant/dashboard" };

/**
 * One tap into the seeded demo buyer or demo warung (POST /auth/demo). When the app is
 * not running on demo data the buttons fall back to the normal login.
 */
export function DemoLoginButtons({ demo, className }: { demo: boolean; className?: string }) {
  const router = useRouter();
  const setSessionUser = useSetSessionUser();
  const login = useMutation({
    mutationFn: (role: DemoRole) => api.post<OtpVerifyResponse>("/auth/demo", { role }),
    onSuccess: ({ user }, role) => {
      setSessionUser(user);
      router.push(TARGET[role]);
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Akun demo belum bisa dibuka. Coba lagi."),
  });

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
            className="h-12 rounded-xl px-5 text-base font-bold"
            disabled={login.isPending}
            onClick={() => login.mutate(role)}
          >
            {login.isPending && login.variables === role ? <Loader2Icon className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
            {label}
          </Button>
        ) : (
          <Button key={role} asChild variant={primary ? "default" : "outline"} className="h-12 rounded-xl px-5 text-base font-bold">
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
