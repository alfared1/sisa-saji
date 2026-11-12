/**
 * Weather in the Surplus Prediction Engine: the evening rain forecast that
 * ml/train_predict.py stores with an lgbm-v1 row reaches tonight's prediction
 * on the merchant dashboard; heuristic predictions carry no rain value.
 */
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { merchantSurplusPredictions, merchants, users, type Merchant } from "@/db/schema";
import { wibDate } from "@/lib/time";
import { tonightPrediction } from "@/server/services/merchant/dashboard";
import { reseed, testDb } from "../helpers/db";

const { db, close } = testDb();
let merchant: Merchant;
const today = wibDate();

beforeAll(async () => {
  await reseed(db);
  const [row] = await db
    .select({ merchant: merchants })
    .from(merchants)
    .innerJoin(users, eq(users.id, merchants.ownerUserId))
    .where(eq(users.email, "demo.mitra@sisasaji.test"));
  merchant = row.merchant;
});
afterAll(close);

describe("tonight's prediction and the rain forecast", () => {
  it("heuristic predictions carry no rain value", async () => {
    await db
      .delete(merchantSurplusPredictions)
      .where(
        and(
          eq(merchantSurplusPredictions.merchantId, merchant.id),
          isNull(merchantSurplusPredictions.menuId),
          eq(merchantSurplusPredictions.targetDate, today),
        ),
      );
    const p = await tonightPrediction(db, merchant.id, today);
    expect(p?.model_version).toBe("heuristic-v0");
    expect(p?.rain_forecast_mm).toBeNull();
  });

  it("an lgbm-v1 row passes its evening rain forecast to the dashboard", async () => {
    await db.insert(merchantSurplusPredictions).values({
      merchantId: merchant.id,
      menuId: null,
      targetDate: today,
      dayOfWeek: 4,
      predictedSurplusPortions: 12.5,
      selloutProbabilityAt50pct: 0.7,
      confidenceScore: 0.8,
      rainForecastMm: 7.5,
      modelVersion: "lgbm-v1",
    });
    const p = await tonightPrediction(db, merchant.id, today);
    expect(p).toMatchObject({ model_version: "lgbm-v1", rain_forecast_mm: 7.5, predicted_surplus_portions: 12.5 });
  });
});
