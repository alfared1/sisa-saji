import type { BatchCard } from "@/lib/contracts";
import { laukNoun, laukSoldOut } from "@/lib/lauk";
import { cn } from "@/lib/utils";

type LaukBatch = Pick<BatchCard, "category" | "contents" | "lauk_options" | "lauk_available">;

/**
 * What is in the portion, in words:
 *  - "Isi: Nasi timbel, Sayur asem, Lalapan, Sambal terasi"
 *  - "Lauk tersisa: Ayam goreng, Pepes ikan mas" (when the menu has lauk)
 *  - full mode only, muted: "Habis: Tahu tempe bacem"
 * `lines={1}` shows the lauk line when there is one, else the contents (one clamped line, for
 * tiles); `lines={2}` shows both; `"full"` shows everything unclamped. Renders nothing for a
 * menu that lists neither (older menus).
 */
export function LaukSummary({
  batch,
  lines,
  className,
}: {
  batch: LaukBatch;
  lines: 1 | 2 | "full";
  className?: string;
}) {
  const noun = laukNoun(batch.category);
  const contents = batch.contents.length > 0 ? batch.contents.join(", ") : null;
  const available = batch.lauk_available.length > 0 ? batch.lauk_available.join(", ") : null;
  const soldOut = lines === "full" ? laukSoldOut(batch) : [];

  const rows: { key: string; label: string; text: string; muted?: boolean }[] = [];
  if (lines === 1) {
    if (available) rows.push({ key: "lauk", label: `${noun} tersisa`, text: available });
    else if (contents) rows.push({ key: "isi", label: "Isi", text: contents });
  } else {
    if (contents) rows.push({ key: "isi", label: "Isi", text: contents });
    if (available) rows.push({ key: "lauk", label: `${noun} tersisa`, text: available });
    if (soldOut.length > 0) rows.push({ key: "habis", label: "Habis", text: soldOut.join(", "), muted: true });
  }
  if (rows.length === 0) return null;

  return (
    <div className={cn("space-y-0.5 text-xs leading-snug text-muted-foreground", className)}>
      {rows.map((r) => (
        <p key={r.key} className={cn(lines !== "full" && "line-clamp-1")}>
          <span className={cn("font-semibold", !r.muted && "text-foreground/80")}>{r.label}:</span> {r.text}
        </p>
      ))}
    </div>
  );
}
