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
