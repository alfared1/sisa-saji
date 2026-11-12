/**
 * Checkout helpers (pure, unit-tested): voucher eligibility, the local price
 * preview (mirrors src/lib/pricing/order-totals.ts) and how to react to
 * checkout errors.
 */
import { PLATFORM_COMMISSION_DEFAULT_IDR } from "@/lib/constants";
import type { ErrorCode, Voucher } from "@/lib/contracts";
import { co2GramsFromFoodGrams } from "@/lib/impact";

export type VoucherEligibility = { eligible: boolean; shortfall_idr: number };

export function voucherEligibility(v: Pick<Voucher, "min_subtotal_idr">, subtotalIdr: number): VoucherEligibility {
  const shortfall = Math.max(0, v.min_subtotal_idr - subtotalIdr);
  return { eligible: shortfall === 0, shortfall_idr: shortfall };
}

/** Best eligible voucher by discount (for the "pakai voucher terbaik" hint). */
export function bestVoucher(vouchers: Voucher[], subtotalIdr: number): Voucher | null {
  return (
    vouchers
      .filter((v) => voucherEligibility(v, subtotalIdr).eligible)
      .sort((a, b) => b.discount_idr - a.discount_idr)[0] ?? null
  );
}

export type PricePreview = {
  subtotal_original_idr: number;
  subtotal_recovery_idr: number;
  service_fee_idr: number;
  voucher_discount_idr: number;
  total_idr: number;
  money_saved_idr: number;
  food_saved_grams: number;
  co2_avoided_grams: number;
};

export function previewTotals(args: {
  items: { quantity: number; unit_price_idr: number; original_price_idr: number; portion_weight_grams: number }[];
  voucher: Pick<Voucher, "discount_idr" | "min_subtotal_idr"> | null;
  serviceFeeIdr?: number;
}): PricePreview {
  const fee = args.serviceFeeIdr ?? PLATFORM_COMMISSION_DEFAULT_IDR;
  const recovery = args.items.reduce((s, i) => s + i.quantity * i.unit_price_idr, 0);
  const original = args.items.reduce((s, i) => s + i.quantity * i.original_price_idr, 0);
  const food = args.items.reduce((s, i) => s + i.quantity * i.portion_weight_grams, 0);
  const eligible = args.voucher && voucherEligibility(args.voucher, recovery).eligible;
  const voucherDiscount = eligible && args.voucher ? Math.min(args.voucher.discount_idr, recovery) : 0;
  return {
    subtotal_original_idr: original,
    subtotal_recovery_idr: recovery,
    service_fee_idr: fee,
    voucher_discount_idr: voucherDiscount,
    total_idr: recovery + fee - voucherDiscount,
    money_saved_idr: original - recovery + voucherDiscount,
    food_saved_grams: food,
    co2_avoided_grams: co2GramsFromFoodGrams(food),
  };
}

export type CheckoutErrorAction =
  | { kind: "stock"; batch_id: string | null; available: number | null }
  | { kind: "closed" }
  | { kind: "different_merchant" }
  | { kind: "voucher" }
  | { kind: "login" }
  | { kind: "generic" };

/** Maps an API error from POST /orders/checkout to a UI reaction. */
export function checkoutErrorAction(code: ErrorCode | "NETWORK_ERROR", details: unknown): CheckoutErrorAction {
  switch (code) {
    case "OUT_OF_STOCK": {
      const d = (details ?? {}) as { batch_id?: unknown; available_stock?: unknown };
      return {
        kind: "stock",
        batch_id: typeof d.batch_id === "string" ? d.batch_id : null,
        available: typeof d.available_stock === "number" ? d.available_stock : null,
      };
    }
    case "BATCH_CLOSED":
      return { kind: "closed" };
    case "DIFFERENT_MERCHANT":
      return { kind: "different_merchant" };
    case "VOUCHER_INVALID":
      return { kind: "voucher" };
    case "UNAUTHENTICATED":
      return { kind: "login" };
    default:
      return { kind: "generic" };
  }
}

/** Share text for the impact celebration. */
export function impactShareText(args: { foodKg: string; co2Kg: string; saved: string; merchant: string }): string {
  return (
    `Aku baru menyelamatkan ${args.foodKg} makanan dari ${args.merchant} lewat Sisa-Saji.\n` +
    `Mencegah ${args.co2Kg} CO₂e dan hemat ${args.saved}. Yuk ikut selamatkan makanan di sekitar kampus!`
  );
}

/**
 * Fair-use responses from POST /orders/checkout:
 *  - 409 CONFLICT { order_id } = an unpaid order at this warung already exists
 *  - 409 CONFLICT { pending_order_ids } = too many unpaid orders overall
 * Returns where to send the customer to finish or cancel them, else null.
 */
export function unpaidOrderHref(code: string, details: unknown): string | null {
  if (code !== "CONFLICT" || !details || typeof details !== "object") return null;
  const d = details as { order_id?: unknown; pending_order_ids?: unknown };
  if (typeof d.order_id === "string") return `/orders/${d.order_id}`;
  if (Array.isArray(d.pending_order_ids)) return "/orders";
  return null;
}

/**
 * Stepper max for one line of a "bayar di warung" ticket: at most `cap` portions on the
 * whole ticket (PAY_AT_WARUNG_MAX_PORTIONS), so the other lines' portions count too.
 */
export function ticketLineMax(
  items: readonly { batch_id: string; quantity: number }[],
  batchId: string,
  lineMax: number,
  cap: number,
): number {
  const others = items.reduce((s, i) => (i.batch_id === batchId ? s : s + i.quantity), 0);
  return Math.max(0, Math.min(lineMax, cap - others));
}

/**
 * Quantities that bring a cart down to `cap` portions, trimming the last lines first
 * (a line may drop to 0 = remove it). Empty when the cart is already within the cap.
 */
export function trimToTicketCap(
  items: readonly { batch_id: string; quantity: number }[],
  cap: number,
): { batch_id: string; quantity: number }[] {
  let over = items.reduce((s, i) => s + i.quantity, 0) - cap;
  const out: { batch_id: string; quantity: number }[] = [];
  for (let k = items.length - 1; k >= 0 && over > 0; k--) {
    const cut = Math.min(over, items[k].quantity);
    out.push({ batch_id: items[k].batch_id, quantity: items[k].quantity - cut });
    over -= cut;
  }
  return out;
}

/** 400 VALIDATION_ERROR per-buyer cap: [{ path: "items", batch_id, max_quantity }]. */
export function perBuyerCaps(code: string, details: unknown): { batch_id: string; max_quantity: number }[] {
  if (code !== "VALIDATION_ERROR" || !Array.isArray(details)) return [];
  return details.flatMap((d) =>
    d && typeof d === "object" && typeof (d as { batch_id?: unknown }).batch_id === "string" &&
    typeof (d as { max_quantity?: unknown }).max_quantity === "number"
      ? [{ batch_id: (d as { batch_id: string }).batch_id, max_quantity: (d as { max_quantity: number }).max_quantity }]
      : [],
  );
}
