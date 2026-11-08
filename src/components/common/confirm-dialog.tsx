"use client";

import type { ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Lanjutkan",
  cancelLabel = "Batal",
  destructive = false,
  loading = false,
  icon,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100%-2rem)] rounded-3xl p-6 sm:max-w-sm">
        <DialogHeader className="items-center text-center sm:text-center">
          {icon && (
            <span
              className={cn(
                "mb-1 inline-flex size-14 items-center justify-center rounded-2xl",
                destructive ? "bg-urgent-soft text-urgent" : "bg-deal-soft text-deal",
              )}
            >
              {icon}
            </span>
          )}
          <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-sm leading-relaxed">{description}</DialogDescription>
          )}
        </DialogHeader>
        {children}
        <DialogFooter className="mt-2 grid grid-cols-2 gap-2 sm:flex-none">
          <Button
            variant="outline"
            className="h-11 rounded-full"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            className={cn(
              "h-11 rounded-full",
              destructive && "bg-urgent text-urgent-foreground hover:bg-urgent/90",
            )}
            onClick={() => void onConfirm()}
            disabled={loading}
          >
            {loading && <Loader2Icon className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
