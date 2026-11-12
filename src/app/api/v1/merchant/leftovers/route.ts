import { connection } from "next/server";
import { getDb } from "@/db";
import { LeftoverReportBody, LeftoverReportQuery } from "@/lib/contracts";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson, parseQuery } from "@/server/http";
import { getLeftoverReport, saveLeftoverReport } from "@/server/services/merchant/leftovers";

/** GET /api/v1/merchant/leftovers?date=YYYY-MM-DD: one night's leftover report. → LeftoverReportView */
export const GET = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const { date } = parseQuery(req, LeftoverReportQuery);
  return ok(await getLeftoverReport(getDb(), merchantId, date));
});

/** PUT /api/v1/merchant/leftovers: record or correct last night's or tonight's leftovers. → LeftoverReportView */
export const PUT = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const body = await parseJson(req, LeftoverReportBody);
  return ok(await saveLeftoverReport(getDb(), merchantId, body));
});
