"use client";

import { Clock3Icon, LeafIcon, PackageCheckIcon, RecycleIcon } from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { ORDER_STATUS_LABELS, type OrderDetail, type OrderStatus } from "@/lib/contracts";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CancelTicketButton, isCancellableTicket } from "./cancel-ticket";

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

export function itemsSummary(order: Pick<OrderDetail, "items">): string {
  return order.items.map((i) => `${i.quantity}× ${i.menu_name}`).join(", ");
}

export function portionsOf(order: Pick<OrderDetail, "items">): number {
  return order.items.reduce((s, i) => s + i.quantity, 0);
}

/**
 * Merchant-side order card (no pickup codes — the customer shows theirs). With `actions`,
 * an open "bayar di warung" ticket gets a "Batalkan tiket" button.
 */
export function MerchantOrderCard({
  order,
  compact = false,
  actions = false,
}: {
  order: OrderDetail;
  compact?: boolean;
  actions?: boolean;
}) {
  const waiting = order.status === "PAID" || order.status === "READY_FOR_PICKUP";
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
              <CountdownBadge endIso={order.pickup_deadline_at} prefix="Ambil" overLabel="Lewat batas" />
            ) : order.status === "COMPLETED" && order.picked_up_at ? (
              <span className="inline-flex items-center gap-1">
                <PackageCheckIcon className="size-3.5 text-primary" aria-hidden /> Diambil {formatClockId(order.picked_up_at)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Clock3Icon className="size-3.5" aria-hidden /> {formatClockId(order.created_at)}
              </span>
            )}
            {order.payment_method === "BAYAR_DI_WARUNG" && (
              <span className="inline-flex items-center rounded-full bg-deal-soft px-2 py-0.5 font-semibold text-deal">
                {order.paid_at ? "Lunas di warung" : "Bayar di warung"}
              </span>
            )}
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
          {actions && isCancellableTicket(order) && (
            <div className="mt-2 -mb-1 flex flex-col items-start gap-1 border-t border-border pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <p className="text-xs text-muted-foreground">
                Batal otomatis jam {formatClockId(order.pickup_deadline_at)} bila tidak diambil.
              </p>
              {/* Stacked on phones: the ghost button's label lines up with the text above. */}
              <CancelTicketButton order={order} className="-ml-3 sm:ml-0" />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
