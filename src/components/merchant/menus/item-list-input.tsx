"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MENU_ITEM_MAX_LEN } from "@/lib/constants";
import { findItem } from "@/lib/lauk";
import { FieldError } from "../ui";

/**
 * A list of short entries typed one at a time ("Isi porsi", "Lauk pilihan pembeli"): Enter or
 * "Tambah" adds the typed entry (also when the field loses focus), each chip has its own
 * remove button. Repeats (ignoring case) and entries past `max` are refused with a message.
 */
export function ItemListInput({
  id,
  label,
  optionalLabel,
  helper,
  placeholder,
  value,
  onChange,
  onBlur,
  max,
  error,
}: {
  id: string;
  label: string;
  /** Shown muted after the label, e.g. "(opsional)". */
  optionalLabel?: string;
  helper?: string;
  placeholder?: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  onBlur?: () => void;
  max: number;
  error?: string;
}) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const full = value.length >= max;

  const add = () => {
    const item = draft.trim().replace(/\s+/g, " ");
    if (!item) return;
    if (findItem(value, item) !== null) {
      setNote(`${item} sudah ada di daftar.`);
      return;
    }
    if (full) {
      setNote(`Paling banyak ${max} isian.`);
      return;
    }
    onChange([...value, item]);
    setDraft("");
    setNote(null);
  };

  const describedBy = [
    helper ? `${id}-hint` : null,
    error ? `${id}-err` : null,
    note ? `${id}-note` : null,
    full ? `${id}-full` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label} {optionalLabel && <span className="font-normal text-muted-foreground">{optionalLabel}</span>}
      </Label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {value.map((item) => (
            <li key={item} className="inline-flex h-9 items-center gap-0.5 rounded-full bg-brand-soft pl-3 text-sm font-semibold text-primary">
              {item}
              <button
                type="button"
                aria-label={`Hapus ${item}`}
                onClick={() => {
                  onChange(value.filter((v) => v !== item));
                  setNote(null);
                }}
                className="inline-flex size-9 items-center justify-center rounded-full outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <XIcon className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={MENU_ITEM_MAX_LEN}
          placeholder={placeholder}
          disabled={full}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            if (note) setNote(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Enter adds the entry instead of submitting the whole form.
              e.preventDefault();
              add();
            }
          }}
          onBlur={() => {
            add();
            onBlur?.();
          }}
          className="h-12 min-w-0 flex-1 rounded-2xl bg-card text-base"
        />
        <button
          type="button"
          onClick={add}
          disabled={full || !draft.trim()}
          className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <PlusIcon className="size-4" aria-hidden /> Tambah
        </button>
      </div>
      {note && (
        <p id={`${id}-note`} className="text-xs font-medium text-urgent" role="status">
          {note}
        </p>
      )}
      {full && (
        <p id={`${id}-full`} className="text-xs text-muted-foreground">
          Sudah {max} isian. Hapus satu untuk menambah.
        </p>
      )}
      <FieldError id={`${id}-err`}>{error}</FieldError>
      {helper && (
        <p id={`${id}-hint`} className="text-xs text-pretty text-muted-foreground">
          {helper}
        </p>
      )}
    </div>
  );
}
