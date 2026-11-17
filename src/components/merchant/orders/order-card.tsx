"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Clock3Icon, LeafIcon, PackageCheckIcon, RecycleIcon, ScanLineIcon } from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { OrderChatButton, OrderChatSheet } from "@/components/common/order-chat";
import { useNow } from "@/hooks/use-now";
import { useSearchParam } from "@/hooks/use-search-param";
import { MERCHANT_TICKET_CANCEL_REASONS, noShowCancelOpensAt } from "@/lib/constants";
import {
  ORDER_STATUS_LABELS,
  type OrderDetail,
  type OrdersResponse,
  type OrderStatus,
  type PaymentMethod,
} from "@/lib/contracts";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { merchantKeys, useIsCashier } from "../lib/queries";
import { CancelTicketButton, isCancellableTicket } from "./cancel-ticket";
import { CancelRequestPanel, isPaidOnlineOpen, OutOfStockCancelButton } from "./paid-order-actions";

const STATUS_CLS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "bg-warning-soft text-amber-800 dark:text-amber-200",
  PAID: "bg-brand-soft text-brand-strong",
  READY_FOR_PICKUP: "bg-success-soft text-primary",
  COMPLETED: "bg-muted text-foreground/70",
  CANCELLED: "bg-urgent-soft text-urgent",
  EXPIRED: "bg-muted text-muted-foreground",
};

export function OrderStatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[11px] leading-none font-semibold", STATUS_CLS[status], className)}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function CustomerAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-sm font-semibold text-secondary-foreground", className)}
    >
      {initialsOf(name)}
    </span>
  );
}

/** One line of the ticket: "2× Nasi Timbel, lauk Ayam goreng" (no lauk part when none was chosen). */
export function itemLine(i: Pick<OrderDetail["items"][number], "quantity" | "menu_name" | "lauk">): string {
  return i.lauk ? `${i.quantity}× ${i.menu_name}, lauk ${i.lauk}` : `${i.quantity}× ${i.menu_name}`;
}

export function itemsSummary(order: Pick<OrderDetail, "items">): string {
  // Lines that name a lauk already contain a comma, so they are separated by semicolons.
  const sep = order.items.some((i) => i.lauk) ? "; " : ", ";
  return order.items.map(itemLine).join(sep);
}

export function portionsOf(order: Pick<OrderDetail, "items">): number {
  return order.items.reduce((s, i) => s + i.quantity, 0);
}

const ONLINE_METHOD_LABEL: Partial<Record<PaymentMethod, string>> = { QRIS: "QRIS", GOPAY: "GoPay", OVO: "OVO", DANA: "DANA" };

/**
 * How the order is paid, as the counter needs to know it: "Lunas QRIS" (nothing to collect) or
 * "Tunai Rp 19.500" (collect this at pickup). Null while an online order is still unpaid.
 */
export function PaymentChip({ order }: { order: OrderDetail }) {
  const cash = order.payment_method === "BAYAR_DI_WARUNG";
  if (cash && !order.paid_at) {
    return (
      <span className="inline-flex items-center rounded-full bg-deal-soft px-2 py-0.5 font-semibold text-deal tabular-nums">
        Tunai {formatIdr(order.total_customer_paid_idr)}
      </span>
    );
  }
  if (!order.paid_at) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-secondary-foreground">
      {cash ? "Lunas di warung" : `Lunas ${ONLINE_METHOD_LABEL[order.payment_method] ?? "online"}`}
    </span>
  );
}

/**
 * Footer of an open cash ticket: when it lapses, and, until the warung may pick it, from when
 * "Tidak datang" can be chosen (so the rule is on the card, not only inside the dialog).
 */
function TicketCancelFooter({ order }: { order: OrderDetail }) {
  const now = useNow(15_000);
  const noShowFrom = noShowCancelOpensAt(order.created_at, order.pickup_deadline_at);
  const noShowLocked = now !== null && now < noShowFrom.getTime();
  return (
    <div className="mt-2 -mb-1 flex flex-col items-start gap-1 border-t border-border pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="text-xs text-muted-foreground">
        <p>Batal otomatis pukul {formatClockId(order.pickup_deadline_at)} bila tidak diambil.</p>
        {noShowLocked && (
          <p className="mt-0.5">
            &ldquo;{MERCHANT_TICKET_CANCEL_REASONS.NO_SHOW.label}&rdquo; bisa dipilih mulai pukul {formatClockId(noShowFrom)}.
          </p>
        )}
      </div>
      {/* Stacked on phones: the ghost button's label lines up with the text above. */}
      <CancelTicketButton order={order} className="-ml-3 shrink-0 sm:ml-0" />
    </div>
  );
}

/**
 * Merchant-side order card (no pickup codes — the customer shows theirs). With `actions`,
 * an open "bayar di warung" ticket gets a "Batalkan tiket" button, and a paid online order gets
 * "Stok habis" or, when the buyer asked to cancel, Setujui / Tolak. `queue` (dashboard pickup
 * queue) adds Scan and Chat right on the card, the two things the counter does next.
 */
export function MerchantOrderCard({
  order,
  compact = false,
  actions = false,
  queue = false,
}: {
  order: OrderDetail;
  compact?: boolean;
  actions?: boolean;
  queue?: boolean;
}) {
  const waiting = order.status === "PAID" || order.status === "READY_FOR_PICKUP";
  const qc = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  // A chat push opens /merchant/orders?chat=<order id>; once closed, the link does not reopen it.
  const [linkClosed, setLinkClosed] = useState(false);
  const chatParam = useSearchParam("chat");
  const linked = (actions || queue) && chatParam === order.id && !linkClosed;
  const onChatOpenChange = (o: boolean) => {
    setChatOpen(o);
    if (!o) setLinkClosed(true);
  };
  const markSeen = useCallback(() => {
    qc.setQueriesData<OrdersResponse>({ queryKey: merchantKeys.ordersAll }, (old) =>
      old
        ? { ...old, orders: old.orders.map((o) => (o.id === order.id && o.unread_messages ? { ...o, unread_messages: 0 } : o)) }
        : old,
    );
  }, [qc, order.id]);
  const chat = (actions || queue) && (waiting || (order.unread_messages ?? 0) > 0);
  // Cancelling and refunds are the owner's decisions; a cashier only serves and chats.
  const isCashier = useIsCashier();
  const ownerActions = actions && !isCashier;
  return (
    <article className={cn("rounded-2xl bg-card ring-1 ring-border", compact ? "p-3" : "p-4")}>
      <div className="flex items-start gap-3">
        <CustomerAvatar name={order.customer.full_name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm leading-tight font-semibold">{order.customer.full_name}</h3>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{order.order_number}</p>
            </div>
            <OrderStatusPill status={order.status} />
          </div>
          <p className="mt-2 text-sm leading-snug text-foreground/85">{itemsSummary(order)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{formatIdr(order.net_merchant_payout_idr)}</span>
            {waiting ? (
              <CountdownBadge endIso={order.pickup_deadline_at} prefix="Ambil dalam" overLabel="Lewat batas" />
            ) : order.status === "COMPLETED" && order.picked_up_at ? (
              <span className="inline-flex items-center gap-1">
                <PackageCheckIcon className="size-3.5 text-primary" aria-hidden /> Diambil {formatClockId(order.picked_up_at)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Clock3Icon className="size-3.5" aria-hidden /> {formatClockId(order.created_at)}
              </span>
            )}
            <PaymentChip order={order} />
            {order.uses_own_lunchbox && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-primary">
                <RecycleIcon className="size-3" aria-hidden /> Bawa wadah
              </span>
            )}
            {order.status === "COMPLETED" && (
              <span className="inline-flex items-center gap-1 text-primary">
                <LeafIcon className="size-3.5" aria-hidden /> {(order.food_saved_grams / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} kg
              </span>
            )}
          </div>
          {(order.status === "CANCELLED" || order.status === "EXPIRED") && order.cancel_reason && (
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{order.cancel_reason}</p>
          )}
          {order.cancel_request?.status === "REJECTED" && waiting && (
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              Permintaan batal ditolak: {order.cancel_request.response}
            </p>
          )}
          {order.refund && (
            <p className="mt-1 text-xs leading-snug font-semibold text-foreground/80">
              {formatIdr(order.refund.amount_idr)} dikembalikan ke pembeli
            </p>
          )}
          {queue && waiting && (
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Link
                href="/merchant/orders/scan"
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ScanLineIcon className="size-4" aria-hidden /> Scan
              </Link>
              <OrderChatButton
                label="Chat"
                variant="outline"
                unread={order.unread_messages ?? 0}
                onClick={() => setChatOpen(true)}
                className="h-11 text-sm"
              />
            </div>
          )}
          {chat && (
            <div className={cn(!queue && "mt-2")}>
              {!queue && (
                <OrderChatButton
                  label="Chat pembeli"
                  variant="ghost"
                  unread={order.unread_messages ?? 0}
                  onClick={() => setChatOpen(true)}
                  className="-ml-3 h-10 px-3 text-sm"
                />
              )}
              <OrderChatSheet
                orderId={order.id}
                as="merchant"
                open={chatOpen || linked}
                onOpenChange={onChatOpenChange}
                title={order.customer.full_name}
                description={`Chat soal pesanan ${order.order_number}`}
                onSeen={markSeen}
              />
            </div>
          )}
          {ownerActions && isPaidOnlineOpen(order) && order.cancel_request?.status === "PENDING" && <CancelRequestPanel order={order} />}
          {ownerActions && isPaidOnlineOpen(order) && order.cancel_request?.status !== "PENDING" && (
            <div className="mt-2 -mb-1 flex items-center justify-between gap-3 border-t border-border pt-2">
              <p className="text-xs text-muted-foreground">Menu habis sebelum diambil?</p>
              <OutOfStockCancelButton order={order} className="-mr-2" />
            </div>
          )}
          {ownerActions && isCancellableTicket(order) && <TicketCancelFooter order={order} />}
          {/* A cashier cannot decide: the request is visible, the decision stays with the owner. */}
          {actions && isCashier && isPaidOnlineOpen(order) && order.cancel_request?.status === "PENDING" && (
            <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
              Pembeli minta batal. Menunggu keputusan pemilik.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
