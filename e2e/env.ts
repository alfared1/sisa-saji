import { DEMO_MERCHANT_NAME, DEMO_MERCHANT_SLUG } from "../src/db/seed/data";
import { CAMPUSES } from "../src/lib/constants";

/** Isolated ports/dirs for the e2e suite (never 3000/5433, which dev uses). */
export const E2E_WEB_PORT = 3123;
export const E2E_DB_PORT = 5463;
export const E2E_PGLITE_DIR = "./.pglite-e2e";
export const E2E_DIST_DIR = ".next-e2e";
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_WEB_PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? `postgres://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`;

/** Default search point of the app: CAMPUSES[0], IPB Dramaga (Bogor). */
export const DEFAULT_POINT = { lat: CAMPUSES[0].lat, lng: CAMPUSES[0].lng } as const;

export const DEMO_CUSTOMER_EMAIL = "demo.pembeli@sisasaji.test";
export const DEMO_MERCHANT_EMAIL = "demo.mitra@sisasaji.test";
/** Seeded demo warung (Warung Nasi Teh Euis, Babakan Raya), owned by the demo merchant account. */
export { DEMO_MERCHANT_NAME, DEMO_MERCHANT_SLUG };
