/**
 * Simulated dynamic QRIS payload (EMVCo Merchant-Presented Mode, Bank Indonesia QRIS profile).
 *
 * Structure: TLV = 2-digit tag + 2-digit length + value. Tag 01 = "12" marks a
 * dynamic (single-use) QR, tag 54 carries the amount, tag 62 the transaction
 * reference, and tag 63 is a CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF) over the
 * whole payload including the literal "6304". A real gateway (Midtrans/Xendit)
 * returns this string from its API; the simulator builds it locally.
 */

export function tlv(tag: string, value: string): string {
  if (!/^\d{2}$/.test(tag)) throw new Error(`Invalid EMV tag ${tag}`);
  if (value.length > 99) throw new Error(`EMV value for tag ${tag} is too long`);
  return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC16-CCITT-FALSE as 4 upper-case hex digits. */
export function crc16CcittFalse(input: string): string {
  let crc = 0xffff;
  const bytes = Buffer.from(input, "utf8");
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Keeps printable ASCII (QR alphanumeric-safe), collapses spaces, truncates. */
function ascii(value: string, max: number): string {
  const clean = value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || "-").slice(0, max).trim() || "-";
}

export interface DynamicQrisInput {
  merchantName: string;
  /** City / regency shown by the payer's app (max 15 chars). */
  merchantCity: string;
  /** Platform-side merchant identifier (e.g. merchant uuid). */
  merchantRef: string;
  amountIdr: number;
  /** Transaction reference (order number). */
  reference: string;
  postalCode?: string;
}

export function buildDynamicQris(input: DynamicQrisInput): string {
  if (!Number.isInteger(input.amountIdr) || input.amountIdr <= 0) throw new Error("QRIS amount must be a positive integer");
  const mid = input.merchantRef.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
  const nmid = `ID${mid.slice(0, 13)}`;
  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv(
      "26",
      tlv("00", "ID.CO.SISASAJI.WWW") + tlv("01", `936000${mid.slice(0, 13)}`) + tlv("02", mid.slice(0, 15)) + tlv("03", "UMI"),
    ) +
    tlv("51", tlv("00", "ID.CO.QRIS.WWW") + tlv("02", nmid) + tlv("03", "UMI")) +
    tlv("52", "5812") +
    tlv("53", "360") +
    tlv("54", String(input.amountIdr)) +
    tlv("58", "ID") +
    tlv("59", ascii(input.merchantName, 25)) +
    tlv("60", ascii(input.merchantCity, 15).toUpperCase()) +
    (input.postalCode ? tlv("61", ascii(input.postalCode, 10)) : "") +
    tlv("62", tlv("01", ascii(input.reference, 25)) + tlv("05", ascii(input.reference, 25)) + tlv("07", "SISASAJI"));
  const withCrcTag = `${body}6304`;
  return withCrcTag + crc16CcittFalse(withCrcTag);
}

/** Parses one TLV level into a tag → value map (throws on malformed input). */
export function parseTlv(payload: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > payload.length) {
      throw new Error(`Malformed TLV at position ${i}`);
    }
    out.set(tag, payload.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

/** True when tag 63 is the last field and matches the CRC of everything before its value. */
export function hasValidQrisCrc(payload: string): boolean {
  if (payload.length < 8 || payload.slice(-8, -4) !== "6304") return false;
  return crc16CcittFalse(payload.slice(0, -4)) === payload.slice(-4).toUpperCase();
}

/** Best-effort city for tag 60 from an Indonesian address ("…, Mlati, Sleman" → "SLEMAN"). */
export function cityFromAddress(address: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "INDONESIA";
}
