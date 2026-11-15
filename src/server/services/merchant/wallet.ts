/**
 * Warung wallet ("Saldo"): history and payouts.
 *
 *   money in   = net_merchant_payout_idr of every online-paid order, credited when it is
 *                collected (verifyPickup) or when a paid order expires uncollected
 *                (closeUnclaimedOrders). Cash tickets never touch the wallet: the warung was
 *                paid at the counter.
 *   money out  = payouts to the bank / e-wallet account in the warung profile. The balance is
 *                taken in one conditional UPDATE (never below 0); one payout at a time.
 *   simulator  = on demo data (isDemoData) a payout is paid at once and marked simulated; no
 *                money moves. Otherwise it stays PROCESSING until the team transfers it.
 *   demo warung = the shared demo account can try a payout, but its balance is left as it was
 *                (otherwise one visitor would empty it for everybody); the history says so.
 *
 * History lines are derived from the orders and payouts themselves, so they cannot drift from
 * what happened; they cover the last WALLET_HISTORY_DAYS.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchantPayouts, merchants, orders } from "@/db/schema";
import { PAYOUT_MIN_IDR } from "@/lib/constants";
import type { PayoutView, WalletEntry, WalletResponse } from "@/lib/contracts";
import { isDemoData } from "@/lib/env";
import { formatIdr } from "@/lib/time";
import { ApiError } from "@/server/http";
import { UNCLAIMED_ORDER_REASON } from "@/server/services/orders/pickup";
import { maskAccountNumber } from "./views";

const WALLET_HISTORY_DAYS = 30;
const HISTORY_LIMIT = 60;

function payoutView(p: typeof merchantPayouts.$inferSelect): PayoutView {
  return {
    id: p.id,
    amount_idr: p.amountIdr,
    status: p.status,
    bank_code: p.bankCode,
    account_masked: p.accountMasked,
    ref: p.ref,
    simulated: p.simulated,
    requested_at: p.requestedAt.toISOString(),
    paid_at: p.paidAt ? p.paidAt.toISOString() : null,
  };
}

async function loadMerchant(db: Db, merchantId: string) {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!m) throw new ApiError("NOT_FOUND", "Warung tidak ditemukan");
  return m;
}

function destinationOf(m: typeof merchants.$inferSelect): WalletResponse["destination"] {
  const masked = maskAccountNumber(m.bankAccountNumber);
  if (!m.bankCode || !masked) return null;
  return { bank_code: m.bankCode, account_masked: masked, holder: m.bankAccountHolder?.trim() || null };
}

function blockedReason(m: typeof merchants.$inferSelect, pending: boolean): string | null {
  if (m.isPilot && m.walletBalanceIdr <= 0) return "Warung uji coba dibayar langsung oleh pembeli, jadi tidak ada saldo untuk dicairkan.";
  if (!destinationOf(m)) return "Isi rekening atau e-wallet di Pengaturan dulu.";
  if (pending) return "Masih ada pencairan yang sedang diproses.";
  if (m.walletBalanceIdr < PAYOUT_MIN_IDR) return `Saldo minimal ${formatIdr(PAYOUT_MIN_IDR)} untuk dicairkan.`;
  return null;
}

export async function getWallet(db: Db, merchantId: string, now: Date = new Date()): Promise<WalletResponse> {
  const m = await loadMerchant(db, merchantId);
  const since = new Date(now.getTime() - WALLET_HISTORY_DAYS * 24 * 60 * 60_000);

  const [credited, payouts] = await Promise.all([
    db
      .select({
        number: orders.orderNumber,
        status: orders.status,
        payout: orders.netMerchantPayoutIdr,
        pickedUpAt: orders.pickedUpAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          ne(orders.paymentMethod, "BAYAR_DI_WARUNG"),
          isNotNull(orders.paidAt),
          or(
            and(eq(orders.status, "COMPLETED"), gt(orders.pickedUpAt, since)),
            and(eq(orders.status, "EXPIRED"), eq(orders.cancelReason, UNCLAIMED_ORDER_REASON), gt(orders.updatedAt, since)),
          ),
        ),
      )
      .orderBy(desc(sql`COALESCE(${orders.pickedUpAt}, ${orders.updatedAt})`))
      .limit(HISTORY_LIMIT),
    db
      .select()
      .from(merchantPayouts)
      .where(eq(merchantPayouts.merchantId, merchantId))
      .orderBy(desc(merchantPayouts.requestedAt))
      .limit(HISTORY_LIMIT),
  ]);

  const entries: WalletEntry[] = [
    ...credited.map((o): WalletEntry => {
      const collected = o.status === "COMPLETED";
      return {
        kind: collected ? "ORDER" : "UNCLAIMED",
        amount_idr: o.payout,
        at: (collected && o.pickedUpAt ? o.pickedUpAt : o.updatedAt).toISOString(),
        label: collected ? "Pesanan diambil" : "Pesanan tidak diambil pembeli",
        order_number: o.number,
        payout_status: null,
      };
    }),
    ...payouts
      .filter((p) => p.requestedAt > since)
      .map(
        (p): WalletEntry => ({
          kind: "PAYOUT",
          amount_idr: -p.amountIdr,
          at: p.requestedAt.toISOString(),
          label: `Dicairkan ke ${p.bankCode} ${p.accountMasked}`,
          order_number: null,
          payout_status: p.status,
        }),
      ),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, HISTORY_LIMIT);

  const pending = payouts.some((p) => p.status === "PROCESSING");
  return {
    balance_idr: m.walletBalanceIdr,
    min_payout_idr: PAYOUT_MIN_IDR,
    destination: destinationOf(m),
    payout_blocked_reason: blockedReason(m, pending),
    simulated: isDemoData(),
    entries,
    payouts: payouts.map(payoutView),
  };
}

/** Takes `amount` from the wallet (never below 0) and records a payout to the profile's account. */
export async function requestPayout(
  db: Db,
  merchantId: string,
  amountIdr: number,
  now: Date = new Date(),
  opts: { sharedDemoAccount?: boolean } = {},
): Promise<{ payout: PayoutView; balance_idr: number }> {
  if (amountIdr < PAYOUT_MIN_IDR) {
    throw new ApiError("VALIDATION_ERROR", `Minimal pencairan ${formatIdr(PAYOUT_MIN_IDR)}.`, [
      { path: "amount_idr", message: `Minimal ${formatIdr(PAYOUT_MIN_IDR)}` },
    ]);
  }
  const keepBalance = opts.sharedDemoAccount === true;
  const simulated = isDemoData() || keepBalance;
  return db.transaction(async (tx) => {
    // Serialise payouts per warung (the pending check and the balance update belong together).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merchant_payout'), hashtext(${merchantId}))`);
    const [m] = await tx.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
    if (!m) throw new ApiError("NOT_FOUND", "Warung tidak ditemukan");
    const dest = destinationOf(m);
    if (!dest) throw new ApiError("VALIDATION_ERROR", "Isi rekening atau e-wallet di Pengaturan dulu.");
    const [pending] = await tx
      .select({ id: merchantPayouts.id })
      .from(merchantPayouts)
      .where(and(eq(merchantPayouts.merchantId, merchantId), eq(merchantPayouts.status, "PROCESSING")))
      .limit(1);
    if (pending) throw new ApiError("CONFLICT", "Masih ada pencairan yang sedang diproses.");

    const [taken] = keepBalance
      ? m.walletBalanceIdr >= amountIdr
        ? [{ balance: m.walletBalanceIdr }]
        : []
      : await tx
          .update(merchants)
          .set({ walletBalanceIdr: sql`${merchants.walletBalanceIdr} - ${amountIdr}`, updatedAt: now })
          .where(and(eq(merchants.id, merchantId), sql`${merchants.walletBalanceIdr} >= ${amountIdr}`))
          .returning({ balance: merchants.walletBalanceIdr });
    if (!taken) {
      throw new ApiError("VALIDATION_ERROR", `Saldo tidak cukup. Saldo sekarang ${formatIdr(m.walletBalanceIdr)}.`, [
        { path: "amount_idr", message: "Melebihi saldo" },
      ]);
    }
    const [p] = await tx
      .insert(merchantPayouts)
      .values({
        merchantId,
        amountIdr,
        status: simulated ? "PAID" : "PROCESSING",
        bankCode: dest.bank_code,
        accountMasked: dest.account_masked,
        accountHolder: dest.holder,
        ref: `PO-${randomBytes(5).toString("hex").toUpperCase()}`,
        simulated,
        requestedAt: now,
        paidAt: simulated ? now : null,
      })
      .returning();
    return { payout: payoutView(p), balance_idr: taken.balance };
  });
}
