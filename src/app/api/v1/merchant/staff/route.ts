import { connection } from "next/server";
import { getDb } from "@/db";
import { AddCashierBody, type StaffResponse } from "@/lib/contracts";
import { assertDemoUnlocked, requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { addCashier, listCashiers } from "@/server/services/merchant/staff";

/** GET /api/v1/merchant/staff — owner: the warung's cashiers. */
export const GET = handle(async () => {
  await connection();
  const { merchantId } = await requireMerchant();
  return ok<StaffResponse>(await listCashiers(getDb(), merchantId));
});

/** POST /api/v1/merchant/staff — owner adds a cashier by phone (403 DEMO_LOCKED on the demo warung). */
export const POST = handle(async (req) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  assertDemoUnlocked(user);
  const body = await parseJson(req, AddCashierBody);
  const data = await addCashier(getDb(), {
    merchantId,
    ownerUserId: user.id,
    phoneNumber: body.phone_number,
    fullName: body.full_name,
  });
  return ok<StaffResponse>(data, { status: 201 });
});
