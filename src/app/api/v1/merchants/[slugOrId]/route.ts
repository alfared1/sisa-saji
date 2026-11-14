import { connection } from "next/server";
import { getDb } from "@/db";
import { MerchantDetailQuery, type MerchantDetail } from "@/lib/contracts";
import { getSessionUser } from "@/server/auth/session";
import { handle, ok, parseQuery } from "@/server/http";
import { getMerchantDetail } from "@/server/services/discovery/discovery";

type Ctx = { params: Promise<{ slugOrId: string }> };

/** GET /api/v1/merchants/:slugOrId?lat&lng — public. */
export const GET = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { slugOrId } = await params;
  const q = parseQuery(req, MerchantDetailQuery);
  const me = await getSessionUser();
  const detail = await getMerchantDetail(getDb(), decodeURIComponent(slugOrId), {
    lat: q.lat,
    lng: q.lng,
    userId: me?.id ?? null,
    viewerIsDemo: me?.is_demo === true,
  });
  return ok<MerchantDetail>(detail);
});
