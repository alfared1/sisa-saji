/**
 * Offline copies of active pickup tickets (READY_FOR_PICKUP OrderDetail), so a
 * student can still show the QR / SJ-code at the warung with weak signal.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OrderDetail } from "@/lib/contracts";
import { persistStorage } from "@/lib/pwa/storage";

export type SavedTicket = { order: OrderDetail; saved_at: string };

type TicketsState = {
  tickets: Record<string, SavedTicket>;
  /** Session user the saved tickets belong to (null = unknown / none). */
  owner_user_id: string | null;
  /**
   * Call with the user id /auth/me confirmed (null = confirmed logged out).
   * A different user (or a logout) wipes the tickets: on a shared phone the
   * next person must never see the previous user's pickup code / QR.
   */
  reconcileOwner: (userId: string | null) => void;
  /** Saves READY_FOR_PICKUP orders; any other status removes the offline copy. */
  syncOrder: (order: OrderDetail) => void;
  removeTicket: (orderId: string) => void;
  /** Drops tickets whose pickup deadline passed more than `graceMinutes` ago. */
  pruneExpired: (nowMs: number, graceMinutes?: number) => void;
  clear: () => void;
};

export const useTicketsStore = create<TicketsState>()(
  persist(
    (set) => ({
      tickets: {},
      owner_user_id: null,

      reconcileOwner: (userId) =>
        set((s) => {
          if (userId === null) {
            return Object.keys(s.tickets).length === 0 && s.owner_user_id === null
              ? s
              : { tickets: {}, owner_user_id: null };
          }
          if (s.owner_user_id === userId) return s;
          return { tickets: {}, owner_user_id: userId };
        }),

      syncOrder: (order) =>
        set((s) => {
          if (order.status === "READY_FOR_PICKUP") {
            return {
              tickets: { ...s.tickets, [order.id]: { order, saved_at: new Date().toISOString() } },
            };
          }
          if (!(order.id in s.tickets)) return s;
          const next = { ...s.tickets };
          delete next[order.id];
          return { tickets: next };
        }),

      removeTicket: (orderId) =>
        set((s) => {
          if (!(orderId in s.tickets)) return s;
          const next = { ...s.tickets };
          delete next[orderId];
          return { tickets: next };
        }),

      pruneExpired: (nowMs, graceMinutes = 60) =>
        set((s) => {
          const next: Record<string, SavedTicket> = {};
          let changed = false;
          for (const [id, t] of Object.entries(s.tickets)) {
            const deadline = Date.parse(t.order.pickup_deadline_at);
            if (Number.isFinite(deadline) && deadline + graceMinutes * 60_000 < nowMs) changed = true;
            else next[id] = t;
          }
          return changed ? { tickets: next } : s;
        }),

      clear: () => set({ tickets: {}, owner_user_id: null }),
    }),
    {
      name: "ss-tickets",
      version: 1,
      storage: persistStorage(),
      skipHydration: true,
      partialize: (s) => ({ tickets: s.tickets, owner_user_id: s.owner_user_id }),
    },
  ),
);

export const selectTicketList = (s: Pick<TicketsState, "tickets">): SavedTicket[] =>
  Object.values(s.tickets).sort((a, b) =>
    a.order.pickup_deadline_at.localeCompare(b.order.pickup_deadline_at),
  );
