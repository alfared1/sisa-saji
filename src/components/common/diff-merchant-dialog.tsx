"use client";

import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { StoreIcon } from "lucide-react";
import { type CartItem, type CartMerchant, useCartStore } from "@/stores/cart";
import { ConfirmDialog } from "./confirm-dialog";

/** Blueprint DiffMerchantModal (single-merchant cart guardrail). */
export const DIFF_MERCHANT_COPY =
  "Pesanan kamu sebelumnya akan terhapus apabila memesan item di mitra ini. Lanjutkan?";

export function DiffMerchantDialog({
  open,
  onOpenChange,
  currentMerchantName,
  newMerchantName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentMerchantName?: string;
  newMerchantName?: string;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<StoreIcon className="size-7" />}
      title="Ganti warung?"
      description={
        <>
          {DIFF_MERCHANT_COPY}
          {currentMerchantName && newMerchantName && (
            <span className="mt-2 block text-xs text-muted-foreground">
              Keranjang dari <b className="text-foreground">{currentMerchantName}</b> akan diganti dengan{" "}
              <b className="text-foreground">{newMerchantName}</b>, karena pengambilan dilakukan di satu warung.
            </span>
          )}
        </>
      }
      confirmLabel="Ya, ganti"
      cancelLabel="Batal"
      onConfirm={onConfirm}
    />
  );
}

/**
 * Add-to-cart with the single-merchant guardrail:
 *
 *   const { addToCart, dialog } = useAddToCart();
 *   <Button onClick={() => addToCart(merchant, item)} /> {dialog}
 */
export function useAddToCart(): {
  addToCart: (merchant: CartMerchant, item: CartItem) => "added" | "different_merchant";
  dialog: ReactNode;
} {
  const addItem = useCartStore((s) => s.addItem);
  const replaceCart = useCartStore((s) => s.replaceCart);
  const currentMerchant = useCartStore((s) => s.merchant);
  const [pending, setPending] = useState<{ merchant: CartMerchant; item: CartItem } | null>(null);

  const addToCart = useCallback(
    (merchant: CartMerchant, item: CartItem) => {
      const result = addItem(merchant, item);
      if (result === "different_merchant") setPending({ merchant, item });
      else toast.success(`${item.menu_name} masuk keranjang`, { id: `cart-${item.batch_id}`, duration: 1800 });
      return result;
    },
    [addItem],
  );

  const dialog = (
    <DiffMerchantDialog
      open={pending !== null}
      onOpenChange={(o) => !o && setPending(null)}
      currentMerchantName={currentMerchant?.name}
      newMerchantName={pending?.merchant.name}
      onConfirm={() => {
        if (pending) {
          replaceCart(pending.merchant, pending.item);
          toast.success(`Keranjang diganti ke ${pending.merchant.name}`);
        }
        setPending(null);
      }}
    />
  );

  return { addToCart, dialog };
}
