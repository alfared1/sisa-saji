"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { initInstallPromptCapture } from "@/lib/pwa/install-prompt";
import { rehydratePersistedStores } from "@/stores/hydration";
import { makeQueryClient } from "./query-client";

function ClientBootstrap() {
  useEffect(() => {
    initInstallPromptCapture();
    void rehydratePersistedStores();
  }, []);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <ClientBootstrap />
          {children}
          <Toaster position="top-center" closeButton offset={16} mobileOffset={12} />
          <ServiceWorkerRegister />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
