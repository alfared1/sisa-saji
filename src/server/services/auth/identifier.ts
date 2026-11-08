/**
 * Login identifiers: Indonesian phone numbers are normalised to +62…, emails to
 * lower case. The normalised value is what otp_codes.identifier and the users
 * table store.
 */
export type OtpChannel = "WHATSAPP" | "EMAIL";

export type LoginIdentifier =
  | { kind: "phone"; value: string; channel: "WHATSAPP" }
  | { kind: "email"; value: string; channel: "EMAIL" };

/** "0812-3456 7890" / "62812…" / "+62812…" → "+62812…". Returns the cleaned input when it is not Indonesian. */
export function normalizePhone(input: string): string {
  const cleaned = input.trim().replace(/[\s().-]/g, "");
  if (cleaned.startsWith("+62")) return cleaned;
  if (cleaned.startsWith("62")) return `+${cleaned}`;
  if (cleaned.startsWith("0")) return `+62${cleaned.slice(1)}`;
  return cleaned;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Builds the identifier from validated contract input (exactly one of phone_number / email is set). */
export function toLoginIdentifier(input: { phone_number?: string; email?: string }): LoginIdentifier {
  if (input.phone_number) return { kind: "phone", value: normalizePhone(input.phone_number), channel: "WHATSAPP" };
  if (input.email) return { kind: "email", value: normalizeEmail(input.email), channel: "EMAIL" };
  throw new Error("Identifier missing (validate with OtpRequestBody/OtpVerifyBody first)");
}

/** "Raka Pratama Putra" → "Raka P."; single names are returned as is. */
export function abbreviateName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Pengguna";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}
