import { connection } from "next/server";
import { getDb } from "@/db";
import type { RepeatPreviewResponse, RepeatPublishResponse } from "@/lib/contracts";
import { DEMO_MAX_BATCH_STOCK } from "@/lib/demo-accounts";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok } from "@/server/http";
import { repeatCandidates, repeatYesterday } from "@/server/services/merchant/repeat";

/** GET /api/v1/merchant/surplus/repeat — owner: yesterday's menus that can be put up again now. */
export const GET = handle(async () => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  const candidates = await repeatCandidates(getDb(), merchantId, { maxStock: user.is_demo ? DEMO_MAX_BATCH_STOCK : undefined });
  return ok<RepeatPreviewResponse>({ candidates }, { headers: { "cache-control": "no-store" } });
});

/** POST /api/v1/merchant/surplus/repeat — owner: publishes all of them with the suggested price. */
export const POST = handle(async () => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  const data = await repeatYesterday(getDb(), merchantId, { maxStock: user.is_demo ? DEMO_MAX_BATCH_STOCK : undefined });
  return ok<RepeatPublishResponse>(data, { status: 201 });
});
