"use client";

/**
 * /orders/[id] — OrderDetailScreen: a small state machine over order.status.
 *  PENDING_PAYMENT → PaymentView (poll 3 s) · PAID/READY_FOR_PICKUP → pickup
 *  ticket (poll 5 s, offline copy) · COMPLETED → thank-you + celebration +
 *  review · CANCELLED/EXPIRED → explanation.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BanIcon, ReceiptTextIcon, TimerOffIcon, WifiOffIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState, isNetworkError } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import type { OrderDetail, OrderResponse } from "@/lib/contracts";
import { useStoresHydrated } from "@/stores/hydration";
import { useTicketsStore } from "@/stores/tickets";
import { LoginCta, OrderStatusChip } from "../bits";
import { customerKeys } from "../lib/queries";
import { CompletedView, ImpactCelebrationModal, ReviewFormSheet } from "./completed-view";
import { OrderItemsCard } from "./order-bits";
import { PaymentView } from "./payment-view";
import { PickupTicketView } from "./pickup-pass";

const CELEBRATED_KEY = "ss-celebrated-orders";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
/** navigator.onLine (true on the server / during hydration). */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

function wasCelebrated(id: string): boolean {
  try {
    return (JSON.parse(window.sessionStorage.getItem(CELEBRATED_KEY) ?? "[]") as string[]).includes(id);
  } catch {
    return false;
  }
}
function markCelebrated(id: string) {
  try {
    const list = JSON.parse(window.sessionStorage.getItem(CELEBRATED_KEY) ?? "[]") as string[];
    window.sessionStorage.setItem(CELEBRATED_KEY, JSON.stringify([...list.slice(-20), id]));
  } catch {
    /* storage blocked */
  }
}

function pollMs(order: OrderDetail | undefined): number | false {
  if (!order) return false;
  if (order.status === "PENDING_PAYMENT") return 3000;
  if (order.status === "PAID" || order.status === "READY_FOR_PICKUP") return 5000;
  return false;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 px-4 pt-4" aria-busy="true" aria-label="Memuat pesanan">
      <Skeleton className="h-20 w-full rounded-3xl" />
      <Skeleton className="h-96 w-full rounded-3xl" />
      <Skeleton className="h-40 w-full rounded-3xl" />
    </div>
  );
}

function ClosedView({ order }: { order: OrderDetail }) {
  const expired = order.status === "EXPIRED";
  return (
    <div className="flex flex-col gap-4 px-4 pt-2 pb-10">
      <EmptyState
        icon={expired ? TimerOffIcon : BanIcon}
        title={expired ? "Pesanan kedaluwarsa" : "Pesanan dibatalkan"}
        description={
          order.cancel_reason ??
          (expired
            ? "Pembayaran tidak diterima sebelum batas waktu, jadi porsinya kami kembalikan ke warung."
            : "Pesanan ini sudah dibatalkan dan stoknya dikembalikan ke warung.")
        }
        action={
          <div className="flex flex-col items-center gap-2">
            <Button asChild className="h-11 rounded-full px-6 font-bold">
              <Link href="/discover">Cari makanan lain</Link>
            </Button>
            <Button asChild variant="ghost" className="h-10 rounded-full">
              <Link href={`/warung/${order.merchant.slug}`}>Lihat {order.merchant.name}</Link>
            </Button>
          </div>
        }
      />
      <OrderItemsCard order={order} className="opacity-80" />
    </div>
  );
}

export function OrderDetailScreen({ id }: { id: string }) {
  const qc = useQueryClient();
  const session = useSession();
  const hydrated = useStoresHydrated();
  const savedTicket = useTicketsStore((s) => s.tickets[id]);
  const syncOrder = useTicketsStore((s) => s.syncOrder);
  const [celebrate, setCelebrate] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const prevStatus = useRef<string | null>(null);
  const online = useOnline();

  const q = useQuery({
    queryKey: customerKeys.order(id),
    queryFn: () => api.get<OrderResponse>(`/orders/${id}`),
    refetchInterval: (query) => pollMs(query.state.data?.order),
    refetchIntervalInBackground: false,
    retry: (count, err) => !(err instanceof ApiClientError && err.status >= 400 && err.status < 500) && count < 2,
  });

  const live = q.data?.order;
  const offlineCopy = !live && hydrated && savedTicket ? savedTicket.order : undefined;
  const order = live ?? offlineCopy;
  const showingOffline =
    !online || Boolean(offlineCopy) || (q.isError && isNetworkError(q.error) && Boolean(live));

  // Keep the offline ticket store in sync with the server's view.
  useEffect(() => {
    if (live) syncOrder(live);
  }, [live, syncOrder]);

  // Status transitions → toasts / celebration.
  useEffect(() => {
    if (!live) return;
    const prev = prevStatus.current;
    prevStatus.current = live.status;
    if (prev === null) {
      if (live.status === "COMPLETED" && !live.review && !wasCelebrated(live.id)) {
        markCelebrated(live.id);
        const t = setTimeout(() => setCelebrate(true), 300);
        return () => clearTimeout(t);
      }
      return;
    }
    if (prev === live.status) return;
    void qc.invalidateQueries({ queryKey: customerKeys.ordersAll });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (live.status === "READY_FOR_PICKUP" && prev === "PENDING_PAYMENT") {
      toast.success("Pembayaran diterima", { id: "paid", description: "Tunjukkan tiket ini ke warung." });
    }
    if (live.status === "EXPIRED") toast.error("Waktu pembayaran habis", { id: "expired" });
    if (live.status === "COMPLETED") {
      markCelebrated(live.id);
      void qc.invalidateQueries({ queryKey: customerKeys.impact });
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
      // Not cleared on re-run: the follow-up refetch must not cancel the celebration.
      setTimeout(() => setCelebrate(true), 250);
    }
  }, [live, qc]);

  const header = (
    <PageHeader
      title={order ? order.merchant.name : "Pesanan"}
      subtitle={order?.order_number}
      backHref="/orders"
      actions={order && <OrderStatusChip status={order.status} className="mr-1" />}
    />
  );

  if (!order) {
    if (q.isError) {
      const unauth = q.error instanceof ApiClientError && q.error.code === "UNAUTHENTICATED";
      const notFound = q.error instanceof ApiClientError && (q.error.status === 404 || q.error.status === 403);
      return (
        <div className="contents lg:mx-auto lg:block lg:w-full lg:max-w-5xl">
          {header}
          {unauth || (!session.isLoading && !session.user && !isNetworkError(q.error)) ? (
            <LoginCta
              title="Masuk untuk melihat tiket"
              description="Tiket pengambilan hanya bisa dibuka oleh pemilik pesanan."
              next={`/orders/${id}`}
            />
          ) : notFound ? (
            <EmptyState
              icon={ReceiptTextIcon}
              title="Pesanan tidak ditemukan"
              description="Pesanan ini tidak ada atau bukan milik akunmu."
              action={
                <Button asChild className="h-11 rounded-full px-6 font-bold">
                  <Link href="/orders">Lihat pesananku</Link>
                </Button>
              }
            />
          ) : (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
          )}
        </div>
      );
    }
    return (
      <div className="contents lg:mx-auto lg:block lg:w-full lg:max-w-5xl">
        {header}
        <DetailSkeleton />
      </div>
    );
  }

  return (
    <div className="contents lg:mx-auto lg:block lg:w-full lg:max-w-5xl">
      {header}
      {showingOffline && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-2xl bg-warning-soft px-3 py-2.5 text-xs font-semibold ring-1 ring-warning/30" role="status">
          <WifiOffIcon className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
          Kamu sedang offline. Tiket yang tersimpan di perangkat ini tetap bisa ditunjukkan ke warung.
        </div>
      )}

      {order.status === "PENDING_PAYMENT" && <PaymentView order={order} />}
      {(order.status === "PAID" || order.status === "READY_FOR_PICKUP") && (
        <PickupTicketView order={order} savedOffline={hydrated && Boolean(savedTicket)} />
      )}
      {order.status === "COMPLETED" && <CompletedView order={order} onReview={() => setReviewOpen(true)} />}
      {(order.status === "CANCELLED" || order.status === "EXPIRED") && <ClosedView order={order} />}

      {order.status === "COMPLETED" && (
        <>
          <ImpactCelebrationModal
            order={order}
            open={celebrate}
            onOpenChange={setCelebrate}
            onReview={() => setReviewOpen(true)}
          />
          {!order.review && <ReviewFormSheet order={order} open={reviewOpen} onOpenChange={setReviewOpen} />}
        </>
      )}
    </div>
  );
}
