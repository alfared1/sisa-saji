/**
 * Indonesian messages for the contract zod schemas (used as the per-parse error
 * map in zodResolver). Schema-level custom messages (e.g. "Harga minimum tidak
 * boleh melebihi harga normal") still take precedence.
 */
import { formatIdr } from "@/lib/time";

type Issue = {
  code?: string;
  path?: PropertyKey[];
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  expected?: string;
  input?: unknown;
  format?: string;
};

const isMoney = (path: PropertyKey[] | undefined) => path?.some((p) => typeof p === "string" && p.endsWith("_idr")) ?? false;

export function indonesianZodError(issue: Issue): string | undefined {
  const last = issue.path?.[issue.path.length - 1];
  if (last === "lat" || last === "lng") return "Taruh pin lokasi warung di peta";
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined || issue.input === null || (typeof issue.input === "number" && Number.isNaN(issue.input))
        ? "Wajib diisi"
        : "Format tidak valid";
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string") return min <= 1 ? "Wajib diisi" : `Minimal ${min} karakter`;
      if (issue.origin === "number") return isMoney(issue.path) ? `Minimal ${formatIdr(min)}` : `Minimal ${min.toLocaleString("id-ID")}`;
      return "Terlalu sedikit";
    }
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string") return `Maksimal ${max} karakter`;
      if (issue.origin === "number") return isMoney(issue.path) ? `Maksimal ${formatIdr(max)}` : `Maksimal ${max.toLocaleString("id-ID")}`;
      return "Terlalu banyak";
    }
    case "invalid_format":
      return issue.format === "email" ? "Email tidak valid" : issue.format === "url" ? "URL tidak valid" : "Format tidak valid";
    case "invalid_value":
      return "Pilih salah satu opsi";
    default:
      return undefined;
  }
}

export const ZOD_ID_OPTIONS = { error: indonesianZodError } as const;
