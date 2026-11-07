import { inject } from "vitest";
import {
  TEST_PAYMENT_WEBHOOK_SECRET,
  TEST_PICKUP_QR_SECRET,
  TEST_SESSION_SECRET,
} from "./constants";

process.env.DATABASE_URL = inject("databaseUrl");
process.env.PICKUP_QR_SECRET = TEST_PICKUP_QR_SECRET;
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.PAYMENT_WEBHOOK_SECRET = TEST_PAYMENT_WEBHOOK_SECRET;
process.env.OTP_DEV_MODE = "true";
process.env.PAYMENT_PROVIDER = "simulator";
