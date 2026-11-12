/** Seeded demo accounts (src/db/seed): one buyer, and the owner of the demo warung. */
export const DEMO_ACCOUNTS = {
  CUSTOMER: { phone: "081200000001", email: "demo.pembeli@sisasaji.test" },
  MERCHANT: { phone: "081300000001", email: "demo.mitra@sisasaji.test" },
} as const;

export type DemoRole = keyof typeof DEMO_ACCOUNTS;

const DEMO_EMAILS = new Set<string>(Object.values(DEMO_ACCOUNTS).map((a) => a.email));
/** Stored phone numbers are E.164 (+62…). */
const DEMO_PHONES = new Set<string>(Object.values(DEMO_ACCOUNTS).map((a) => `+62${a.phone.slice(1)}`));

/**
 * True for the shared demo accounts anyone can open with one tap. They must never place
 * orders at a real (pilot) warung, which would cook for a buyer who does not exist.
 */
export function isDemoAccount(user: { email: string | null; phoneNumber: string | null }): boolean {
  return (user.email !== null && DEMO_EMAILS.has(user.email)) || (user.phoneNumber !== null && DEMO_PHONES.has(user.phoneNumber));
}

/** Shown (API 403 and UI notice) when a shared demo account tries a locked change. */
export const DEMO_LOCKED_MESSAGE = "Akun demo: perubahan ini dikunci supaya demo tetap rapi untuk semua pengunjung.";
/** `error.details.reason` of that 403, so clients can tell it apart from other FORBIDDEN errors. */
export const DEMO_LOCKED_REASON = "DEMO_LOCKED";
/**
 * Shown up front on screens whose forms are locked for the shared demo accounts (before
 * anyone tried a change, so it names what is locked instead of "perubahan ini").
 */
export const DEMO_LOCKED_NOTICE =
  "Akun demo dipakai bersama, jadi profil, menu, rekening, dan jam buka dikunci supaya tetap rapi untuk semua pengunjung.";

/**
 * The demo warung may publish surplus (that is the demo), but not flood the shared demo with
 * hundreds of portions: at most this many per batch.
 */
export const DEMO_MAX_BATCH_STOCK = 30;
export const DEMO_MAX_BATCH_STOCK_MESSAGE = `Akun demo: paling banyak ${DEMO_MAX_BATCH_STOCK} porsi per menu, supaya stok demo tetap wajar untuk semua pengunjung.`;
