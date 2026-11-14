/**
 * Pickup time slots for checkout (pure, unit-tested): every 15 minutes from the
 * first slot after "now" (and after the latest pickup start) until the earliest
 * pickup_end_time in the cart (for cash, until the hold ends). Times are labelled in WIB.
 */
import { PAY_AT_WARUNG_HOLD_MINUTES } from "@/lib/constants";
import { formatClockId } from "@/lib/time";

/**
 * Last moment the order can be picked up: the earliest batch end, and for a cash ticket
 * ("bayar di warung") never after its hold (now + PAY_AT_WARUNG_HOLD_MINUTES), because the
 * ticket is cancelled then. Null without a batch end.
 */
export function pickupEndIso(args: { nowMs: number; earliestEndIso: string | null; cash: boolean }): string | null {
  const { nowMs, earliestEndIso, cash } = args;
  if (!earliestEndIso) return null;
  const end = Date.parse(earliestEndIso);
  if (!Number.isFinite(end)) return null;
  if (!cash) return earliestEndIso;
  return new Date(Math.min(end, nowMs + PAY_AT_WARUNG_HOLD_MINUTES * 60_000)).toISOString();
}

export const SLOT_STEP_MINUTES = 15;
/** A slot must leave at least this many minutes before the deadline. */
export const SLOT_MIN_LEAD_MINUTES = 5;

export type PickupSlot = { iso: string; label: string };

export function generatePickupSlots(args: {
  nowMs: number;
  endIso: string | null;
  startIso?: string | null;
  stepMinutes?: number;
  max?: number;
}): PickupSlot[] {
  const { nowMs, endIso, startIso = null, stepMinutes = SLOT_STEP_MINUTES, max = 16 } = args;
  if (!endIso) return [];
  const end = Date.parse(endIso);
  if (!Number.isFinite(end)) return [];
  const step = stepMinutes * 60_000;
  const start = Math.max(nowMs, startIso ? Date.parse(startIso) || nowMs : nowMs);
  // First boundary strictly after `start` (WIB is a whole-hour offset, so UTC boundaries match).
  let t = Math.floor(start / step) * step + step;
  const slots: PickupSlot[] = [];
  while (t <= end - SLOT_MIN_LEAD_MINUTES * 60_000 && slots.length < max) {
    const iso = new Date(t).toISOString();
    slots.push({ iso, label: formatClockId(iso) });
    t += step;
  }
  return slots;
}
