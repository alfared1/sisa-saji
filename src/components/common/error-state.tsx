"use client";

import { RotateCwIcon, WifiOffIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export function errorMessage(error: unknown, fallback = "Terjadi kesalahan. Coba lagi sebentar lagi."): string {
  if (error instanceof ApiClientError) return error.message;
  return fallback;
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "NETWORK_ERROR";
}

export function ErrorState({
  error,
  title,
  message,
  onRetry,
  retrying = false,
  compact = false,
  className,
}: {
  error?: unknown;
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const offline = isNetworkError(error);
  const Icon = offline ? WifiOffIcon : TriangleAlertIcon;
  const heading = title ?? (offline ? "Koneksi terputus" : "Gagal memuat data");
  const body = message ?? errorMessage(error);

  if (compact) {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-center gap-3 rounded-2xl bg-urgent-soft p-3 text-sm text-urgent ring-1 ring-urgent/15",
          className,
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 text-foreground/80">{body}</span>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            <RotateCwIcon className={cn(retrying && "animate-spin")} /> Coba lagi
          </Button>
        )}
      </div>
    );
  }

  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-urgent-soft text-urgent">
        <Icon className="size-7" aria-hidden />
      </span>
      <h3 className="mt-2 text-base font-bold">{heading}</h3>
      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{body}</p>
      {onRetry && (
        <Button className="mt-2 h-10 rounded-full px-5" onClick={onRetry} disabled={retrying}>
          <RotateCwIcon className={cn(retrying && "animate-spin")} /> Coba lagi
        </Button>
      )}
    </div>
  );
}
