/**
 * Checkout helpers (pure, unit-tested): voucher eligibility, the local price
 * preview (mirrors src/lib/pricing/order-totals.ts), cash ("bayar tunai di warung")
 * rules and copy, and how to react to checkout errors.
 */
import {
  PAY_AT_WARUNG_HOLD_MINUTES,
  PAYMENT_TTL_SECONDS,
  PLATFORM_COMMISSION_DEFAULT_IDR,
} from "@/lib/constants";
import type { ErrorCode, PaymentMethod, Voucher } from "@/lib/contracts";
import { co2GramsFromFoodGrams } from "@/lib/impact";
import { serviceFeeFor } from "@/lib/pricing/order-totals";

/**
 * A "bayar di warung" ticket: chosen by the buyer at any warung, and forced at pilot warung.
 * Cash pays no service fee, takes no voucher, holds at most PAY_AT_WARUNG_MAX_PORTIONS and
 * keeps the portions PAY_AT_WARUNG_HOLD_MINUTES.
 */
export function isCashPayment(isPilot: boolean, method: PaymentMethod): boolean {
  return isPilot || method === "BAYAR_DI_WARUNG";
}

/** What the server will record for this choice (pilot warung are always cash). */
export function effectivePaymentMethod(isPilot: boolean, method: PaymentMethod): PaymentMethod {
  return isPilot ? "BAYAR_DI_WARUNG" : method;
}

/** Hold note under the "Kunci Porsi Sekarang" button. */
export function holdNoteText(cash: boolean): string {
  return cash
    ? `Porsi ditahan ${PAY_AT_WARUNG_HOLD_MINUTES} menit. Datang, tunjukkan QR atau PIN, lalu bayar di warung.`
    : `Porsi dikunci ${Math.round(PAYMENT_TTL_SECONDS / 60)} menit sampai kamu bayar.`;
}

/** Toast after a successful checkout. */
export function lockedToastText(cash: boolean): string {
  return cash
    ? `Porsi dikunci ${PAY_AT_WARUNG_HOLD_MINUTES} menit. Tunjukkan kode di warung.`
    : `Porsi dikunci ${Math.round(PAYMENT_TTL_SECONDS / 60)} menit. Selesaikan pembayaran.`;
}

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

/**
 * Local price preview. The fee follows `method` (serviceFeeFor: cash pays none) unless
 * `serviceFeeIdr` overrides it; a cash preview never applies a voucher (the server refuses
 * vouchers on cash tickets).
 */
export function previewTotals(args: {
  items: { quantity: number; unit_price_idr: number; original_price_idr: number; portion_weight_grams: number }[];
  voucher: Pick<Voucher, "discount_idr" | "min_subtotal_idr"> | null;
  serviceFeeIdr?: number;
  method?: PaymentMethod;
}): PricePreview {
  const fee = args.serviceFeeIdr ?? (args.method ? serviceFeeFor(args.method) : PLATFORM_COMMISSION_DEFAULT_IDR);
  const voucher = args.method === "BAYAR_DI_WARUNG" ? null : args.voucher;
  const recovery = args.items.reduce((s, i) => s + i.quantity * i.unit_price_idr, 0);
  const original = args.items.reduce((s, i) => s + i.quantity * i.original_price_idr, 0);
  const food = args.items.reduce((s, i) => s + i.quantity * i.portion_weight_grams, 0);
  const eligible = voucher && voucherEligibility(voucher, recovery).eligible;
  const voucherDiscount = eligible && voucher ? Math.min(voucher.discount_idr, recovery) : 0;
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
 * Stepper max for one cart line: the batch's cap (`maxQuantity`, shared by all lines of that
 * batch, one line per lauk) minus what its other lines hold. Never below the line's own
 * quantity, so a stale cap never hides the current value.
 */
export function cartLineMax(
  items: readonly { key: string; batch_id: string; quantity: number }[],
  key: string,
  maxQuantity: number,
): number {
  const line = items.find((i) => i.key === key);
  if (!line) return 0;
  const others = items.reduce((s, i) => (i.batch_id === line.batch_id && i.key !== key ? s + i.quantity : s), 0);
  return Math.max(line.quantity, maxQuantity - others);
}

/**
 * Stepper max for one line of a "bayar di warung" ticket: at most `cap` portions on the
 * whole ticket (PAY_AT_WARUNG_MAX_PORTIONS), so every other line's portions count too.
 */
export function ticketLineMax(
  items: readonly { key: string; quantity: number }[],
  key: string,
  lineMax: number,
  cap: number,
): number {
  const others = items.reduce((s, i) => (i.key === key ? s : s + i.quantity), 0);
  return Math.max(0, Math.min(lineMax, cap - others));
}

/**
 * Quantities that bring a cart down to `cap` portions, trimming the last lines first
 * (a line may drop to 0 = remove it). Empty when the cart is already within the cap.
 */
export function trimToTicketCap<K extends string>(
  items: readonly { key: K; quantity: number }[],
  cap: number,
): { key: K; quantity: number }[] {
  let over = items.reduce((s, i) => s + i.quantity, 0) - cap;
  const out: { key: K; quantity: number }[] = [];
  for (let k = items.length - 1; k >= 0 && over > 0; k--) {
    const cut = Math.min(over, items[k].quantity);
    out.push({ key: items[k].key, quantity: items[k].quantity - cut });
    over -= cut;
  }
  return out;
}

export type LaukUnavailable = { batch_id: string; lauk: string; lauk_available: string[] };

/**
 * 400 VALIDATION_ERROR when a chosen lauk ran out between choosing and checkout:
 * details [{ path: "items", batch_id, lauk, lauk_available }]. Empty for any other error.
 */
export function laukUnavailable(code: string, details: unknown): LaukUnavailable[] {
  if (code !== "VALIDATION_ERROR" || !Array.isArray(details)) return [];
  return details.flatMap((d: unknown) => {
    if (!d || typeof d !== "object") return [];
    const r = d as { batch_id?: unknown; lauk?: unknown; lauk_available?: unknown };
    if (typeof r.batch_id !== "string" || typeof r.lauk !== "string" || !Array.isArray(r.lauk_available)) return [];
    const available = r.lauk_available.filter((x: unknown): x is string => typeof x === "string");
    return [{ batch_id: r.batch_id, lauk: r.lauk, lauk_available: available }];
  });
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
