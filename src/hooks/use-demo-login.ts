"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSetSessionUser } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import type { OtpVerifyResponse, SessionUser } from "@/lib/contracts";
import type { DemoRole } from "@/lib/demo-accounts";

/**
 * One tap into the seeded demo buyer or demo warung (POST /auth/demo, demo data only).
 * `onSignedIn` decides where to go next.
 */
export function useDemoLogin(onSignedIn: (user: SessionUser, role: DemoRole) => void) {
  const setSessionUser = useSetSessionUser();
  return useMutation({
    mutationFn: (role: DemoRole) => api.post<OtpVerifyResponse>("/auth/demo", { role }),
    onSuccess: ({ user }, role) => {
      setSessionUser(user);
      onSignedIn(user, role);
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Akun demo belum bisa dibuka. Coba lagi."),
  });
}
