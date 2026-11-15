"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavigationIcon, RecycleIcon } from "lucide-react";
import { Money } from "@/components/common/money";
import { OrderChatButton, OrderChatSheet } from "@/components/common/order-chat";
import { useSearchParam } from "@/hooks/use-search-param";
import { Button } from "@/components/ui/button";
import type { OrderDetail, OrderResponse } from "@/lib/contracts";
import { PICKUP_CODE_PREFIX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { mapsDirectionsUrl, whatsappUrl } from "../lib/format";
import { customerKeys } from "../lib/queries";

export function pickupCodeLabel(order: Pick<OrderDetail, "pickup_code">): string {
  return order.pickup_code ? `${PICKUP_CODE_PREFIX}${order.pickup_code}` : "-";
}

/** Items + money summary of an order. */
export function OrderItemsCard({ order, className }: { order: OrderDetail; className?: string }) {
  return (
    <section className={cn("rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Rincian pesanan</h2>
        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">{order.order_number}</span>
      </div>
      <ul className="space-y-2">
        {/* One batch may appear on several lines (one per lauk), so the key includes the index. */}
        {order.items.map((i, idx) => (
          <li key={`${idx}-${i.batch_id}`} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-extrabold tabular-nums">{i.quantity}×</span> {i.menu_name}
              {i.lauk && (
                <span className="block text-xs text-muted-foreground">
                  <span className="font-semibold">Lauk:</span> {i.lauk}
                </span>
              )}
            </span>
            <span className="shrink-0 text-right">
              <Money value={i.unit_selling_price_idr * i.quantity} className="font-semibold" />
              <span className="block text-[11px] text-muted-foreground line-through">
                <Money value={i.unit_original_price_idr * i.quantity} />
              </span>
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1.5 border-t border-dashed border-border pt-3 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal pemulihan</dt>
          <dd>
            <Money value={order.subtotal_recovery_idr} />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Biaya layanan</dt>
          <dd>{order.platform_commission_idr > 0 ? <Money value={order.platform_commission_idr} /> : "Gratis"}</dd>
        </div>
        {order.voucher_discount_idr > 0 && (
          <div className="flex justify-between text-primary">
            <dt>Voucher</dt>
            <dd>
              <Money value={order.voucher_discount_idr} prefix="-" />
            </dd>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-1 text-sm">
          <dt className="font-semibold">Total</dt>
          <dd className="text-base font-semibold">
            <Money value={order.total_customer_paid_idr} />
          </dd>
        </div>
      </dl>
      {order.uses_own_lunchbox && (
        <p className="mt-3 flex items-center gap-2 rounded-2xl bg-brand-soft p-2.5 text-xs font-semibold text-secondary-foreground">
          <RecycleIcon className="size-4 shrink-0" /> Bawa wadah sendiri. Tunjukkan wadahmu ke warung.
        </p>
      )}
    </section>
  );
}

/** "Petunjuk Arah (Google Maps)" + "Hubungi Warung (WhatsApp)". */
/**
 * Directions + in-app chat with the warung (unread count on the button; a push opens the chat
 * via ?chat=1). WhatsApp stays as a fallback link with the order already written out.
 */
export function DirectionsAndWhatsAppButtons({ order }: { order: OrderDetail }) {
  const qc = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  // A chat push opens /orders/<id>?chat=1; once closed, the link does not reopen it.
  const [linkClosed, setLinkClosed] = useState(false);
  const linked = useSearchParam("chat") === "1" && !linkClosed;
  const onChatOpenChange = (o: boolean) => {
    setChatOpen(o);
    if (!o) setLinkClosed(true);
  };
  const markSeen = useCallback(() => {
    qc.setQueryData<OrderResponse>(customerKeys.order(order.id), (old) =>
      old && old.order.unread_messages ? { order: { ...old.order, unread_messages: 0 } } : old,
    );
  }, [qc, order.id]);
  const text = `Halo ${order.merchant.name}, saya ${order.customer.full_name} mau ambil pesanan ${order.order_number}${
    order.pickup_code ? ` (kode ${pickupCodeLabel(order)})` : ""
  } dari Sisa-Saji.`;
  return (
    <div>
      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        <Button asChild className="h-12 rounded-xl font-semibold">
          <a href={mapsDirectionsUrl(order.merchant.lat, order.merchant.lng)} target="_blank" rel="noreferrer">
            <NavigationIcon className="size-4" /> Petunjuk Arah
          </a>
        </Button>
        <OrderChatButton label="Chat Warung" unread={order.unread_messages ?? 0} onClick={() => setChatOpen(true)} />
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Tidak dibalas?{" "}
        <a
          href={whatsappUrl(order.merchant.whatsapp_number, text)}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-primary underline-offset-2 hover:underline"
        >
          Hubungi lewat WhatsApp
        </a>
      </p>
      <OrderChatSheet
        orderId={order.id}
        as="customer"
        open={chatOpen || linked}
        onOpenChange={onChatOpenChange}
        title={order.merchant.name}
        description={`Chat soal pesanan ${order.order_number}`}
        onSeen={markSeen}
      />
    </div>
  );
}
