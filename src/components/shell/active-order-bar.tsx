"use client";

/**
 * Deep green bar above the buyer's bottom tabs while an order is running, so the payment or the
 * pickup ticket is one tap away from any tab ("Tiket aktif tidak pernah hilang"). Unpaid orders
 * come first (their payment window is the shortest), then the ticket with the nearest deadline.
 * Reads the server list of active orders; offline it falls back to the tickets saved on the phone.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { formatCountdownText } from "@/components/common/countdown-format";
import { TudungIcon } from "@/components/common/tudung-icon";
import { useCountdown } from "@/hooks/use-countdown";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api/client";
import { CASH_HOLD_URGENT_MINUTES, PICKUP_CODE_PREFIX } from "@/lib/constants";
import type { OrderDetail, OrdersResponse } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { useStoresHydrated } from "@/stores/hydration";
import { selectTicketList, useTicketsStore } from "@/stores/tickets";

export const ACTIVE_ORDERS_KEY = ["orders", "list", "ACTIVE-bar"] as const;

function pickActive(orders: OrderDetail[]): OrderDetail | null {
  const unpaid = orders
    .filter((o) => o.status === "PENDING_PAYMENT")
    .sort((a, b) => a.payment_expires_at.localeCompare(b.payment_expires_at));
  if (unpaid[0]) return unpaid[0];
  const ready = orders
    .filter((o) => o.status === "READY_FOR_PICKUP" || o.status === "PAID")
    .sort((a, b) => a.pickup_deadline_at.localeCompare(b.pickup_deadline_at));
  return ready[0] ?? null;
}

export function useActiveOrder(enabled = true): { order: OrderDetail | null; count: number } {
  const session = useSession();
  const hydrated = useStoresHydrated();
  const saved = useTicketsStore((s) => s.tickets);
  const q = useQuery({
    queryKey: ACTIVE_ORDERS_KEY,
    queryFn: () => api.get<OrdersResponse>("/orders", { status: "ACTIVE", limit: 10 }),
    enabled: enabled && Boolean(session.user),
    refetchInterval: 30_000,
  });
  const list = !enabled
    ? []
    : (q.data?.orders ?? (hydrated ? selectTicketList({ tickets: saved }).map((t) => t.order) : []));
  return { order: pickActive(list), count: list.length };
}

export function ActiveOrderBar({ order, className }: { order: OrderDetail; className?: string }) {
  const unpaid = order.status === "PENDING_PAYMENT";
  const c = useCountdown(unpaid ? order.payment_expires_at : order.pickup_deadline_at, unpaid ? 2 : CASH_HOLD_URGENT_MINUTES);
  if (c.ready && c.isOver) return null;

  const code = order.pickup_code ? `${PICKUP_CODE_PREFIX}${order.pickup_code}` : order.order_number;
  const title = unpaid ? `Bayar pesanan ${order.order_number}` : `Tiket ${code} siap diambil`;
  const time = c.ready ? formatCountdownText(c, unpaid ? "Bayar dalam" : "Ambil dalam") : unpaid ? "Menunggu bayar" : "Siap diambil";
  const where = unpaid ? `· ${order.merchant.name}` : `di ${order.merchant.name}`;

  return (
    <Link
      href={`/orders/${order.id}`}
      className={cn(
        "ss-anyaman flex min-h-15 items-center gap-3 bg-deep px-4 py-2.5 text-on-deep outline-none",
        "hover:shadow-[inset_0_0_0_999px_rgb(255_255_255/0.08)] focus-visible:ring-3 focus-visible:ring-leaf focus-visible:ring-inset",
        className,
      )}
    >
      <TudungIcon className="size-7 shrink-0 text-leaf" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold">{title}</span>
        <span className={cn("truncate text-[13px] tabular-nums", c.isUrgent ? "font-semibold text-on-deep-urgent" : "text-leaf")}>
          {time} {where}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center text-sm font-bold">
        {unpaid ? "Bayar" : "Buka"}
        <ChevronRightIcon className="size-4.5" aria-hidden />
      </span>
    </Link>
  );
}
