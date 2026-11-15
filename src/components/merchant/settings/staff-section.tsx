"use client";

import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon, UsersIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DemoLockNotice } from "@/components/common/demo-lock-notice";
import { errorMessage } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import type { AddCashierBody, CashierView, StaffResponse } from "@/lib/contracts";
import { merchantKeys, useMerchantReady } from "../lib/queries";
import { SectionCard } from "../ui";

/**
 * "Kasir": the owner adds helpers by phone number. A cashier logs in with that number (OTP) and
 * only sees the pickup queue, the scanner and buyer chat; no money, menus or settings.
 */
export function StaffSection({ locked }: { locked: boolean }) {
  const qc = useQueryClient();
  const ready = useMerchantReady();
  const phoneId = useId();
  const nameId = useId();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<CashierView | null>(null);
  const q = useQuery({ queryKey: merchantKeys.staff, queryFn: () => api.get<StaffResponse>("/merchant/staff"), enabled: ready });

  const add = useMutation({
    mutationFn: (body: AddCashierBody) => api.post<StaffResponse>("/merchant/staff", body),
    onSuccess: (res) => {
      qc.setQueryData(merchantKeys.staff, res);
      setPhone("");
      setName("");
      toast.success("Kasir ditambahkan", { description: "Minta dia masuk dengan nomor itu, lalu buka menu Kasir di Akun." });
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menambah kasir.")),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.del<StaffResponse>(`/merchant/staff/${userId}`),
    onSuccess: (res) => {
      qc.setQueryData(merchantKeys.staff, res);
      setRemoving(null);
      toast("Kasir dihapus", { description: "Aksesnya ke warungmu langsung berhenti." });
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menghapus kasir.")),
  });

  const cashiers = q.data?.cashiers ?? [];
  const full = q.data ? cashiers.length >= q.data.max : false;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    add.mutate({ phone_number: phone.trim(), full_name: name.trim() || undefined });
  };

  return (
    <SectionCard title="Kasir" icon={UsersIcon} description="Kasir bisa melihat antrean, scan tiket, dan chat pembeli. Tidak bisa melihat saldo atau mengubah menu.">
      {locked && <DemoLockNotice className="mb-3" message="Akun demo: menambah kasir dikunci." />}
      {cashiers.length > 0 && (
        <ul className="mb-3 divide-y divide-border rounded-2xl ring-1 ring-border">
          {cashiers.map((c) => (
            <li key={c.user_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{c.full_name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{c.phone_number}</p>
              </div>
              {!locked && (
                <Button
                  variant="ghost"
                  className="h-10 rounded-xl px-3 text-xs font-semibold text-urgent hover:bg-urgent-soft hover:text-urgent"
                  onClick={() => setRemoving(c)}
                >
                  Hapus
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!locked && !full && (
        <form onSubmit={onSubmit} className="space-y-2">
          <div>
            <label htmlFor={phoneId} className="text-xs font-semibold">
              Nomor HP kasir
            </label>
            <Input
              id={phoneId}
              inputMode="tel"
              autoComplete="off"
              placeholder="0812…"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 h-11 rounded-xl"
            />
          </div>
          <div>
            <label htmlFor={nameId} className="text-xs font-semibold">
              Nama (boleh kosong)
            </label>
            <Input id={nameId} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="mt-1 h-11 rounded-xl" />
          </div>
          <Button type="submit" variant="outline" className="h-11 w-full rounded-xl font-semibold" disabled={!phone.trim() || add.isPending}>
            {add.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Tambah kasir
          </Button>
        </form>
      )}
      {full && <p className="text-xs text-muted-foreground">Sudah {q.data?.max} kasir, batas per warung.</p>}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title={`Hapus ${removing?.full_name ?? "kasir"}?`}
        description="Dia tidak bisa lagi melihat antrean atau scan tiket warungmu."
        confirmLabel="Ya, hapus"
        cancelLabel="Batal"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.user_id);
        }}
      />
    </SectionCard>
  );
}
