"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GiftIcon, PencilIcon, PlusIcon, UtensilsCrossedIcon } from "lucide-react";
import { CATEGORY_ICONS } from "@/components/common/category-chips";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState, errorMessage } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useMediaQuery } from "@/hooks/use-media-query";
import { api } from "@/lib/api/client";
import { MENU_CATEGORY_LABELS, type MenuCreateBody, type MenuUpdateBody, type MenuView, type MerchantMeResponse } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { stripEmpty } from "../lib/logic";
import { MERCHANT_ME_QUERY_KEY, merchantKeys, useMerchantMe } from "../lib/queries";
import { MerchantPage, MerchantPageHeader } from "../ui";
import { EMPTY_MENU, MenuForm, menuToFormValues, type MenuFormOutput } from "./menu-form";

type MenuResponse = { menu: MenuView };
type Editing = { mode: "create" } | { mode: "edit"; menu: MenuView } | null;

function upsertMenu(old: MerchantMeResponse | undefined, menu: MenuView): MerchantMeResponse | undefined {
  if (!old) return old;
  const exists = old.menus.some((m) => m.id === menu.id);
  return { ...old, menus: exists ? old.menus.map((m) => (m.id === menu.id ? menu : m)) : [...old.menus, menu] };
}

/** Only the fields that changed, as a MenuUpdateBody (description "" → null). */
export function menuPatch(before: MenuView, after: MenuFormOutput): MenuUpdateBody {
  const patch: MenuUpdateBody = {};
  if (after.menu_name !== before.menu_name) patch.menu_name = after.menu_name;
  if (after.category !== before.category) patch.category = after.category;
  const desc = after.description?.trim() ? after.description.trim() : null;
  if (desc !== (before.description ?? null)) patch.description = desc;
  if (after.original_price_idr !== before.original_price_idr) patch.original_price_idr = after.original_price_idr;
  if (after.min_recovery_price_idr !== before.min_recovery_price_idr) patch.min_recovery_price_idr = after.min_recovery_price_idr;
  if (after.portion_weight_grams !== before.portion_weight_grams) patch.portion_weight_grams = after.portion_weight_grams;
  if (after.is_mystery_bag !== before.is_mystery_bag) patch.is_mystery_bag = after.is_mystery_bag;
  return patch;
}

function MenuCard({ menu, onEdit, onToggle, toggling }: { menu: MenuView; onEdit: () => void; onToggle: (v: boolean) => void; toggling: boolean }) {
  const Icon = menu.is_mystery_bag ? GiftIcon : CATEGORY_ICONS[menu.category];
  const floorPct = Math.round((menu.min_recovery_price_idr / menu.original_price_idr) * 100);
  return (
    <li className={cn("flex flex-col rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border transition-opacity", !menu.is_active && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex size-12 shrink-0 items-center justify-center rounded-2xl",
            menu.is_mystery_bag ? "bg-deal text-deal-foreground" : "bg-brand-soft text-primary",
            !menu.is_active && "grayscale",
          )}
          aria-hidden
        >
          <Icon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-snug font-semibold">{menu.menu_name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {menu.is_mystery_bag ? "Paket Kejutan" : MENU_CATEGORY_LABELS[menu.category]}
          </p>
        </div>
        <label className="flex h-11 shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold">
          <span className={menu.is_active ? "text-primary" : "text-muted-foreground"}>{menu.is_active ? "Aktif" : "Nonaktif"}</span>
          <Switch checked={menu.is_active} disabled={toggling} onCheckedChange={onToggle} aria-label={`${menu.is_active ? "Nonaktifkan" : "Aktifkan"} ${menu.menu_name}`} />
        </label>
      </div>
      {menu.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{menu.description}</p>}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-2xl bg-surface p-2.5">
          <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Normal
          </dt>
          <dd className="font-extrabold tabular-nums">{formatIdr(menu.original_price_idr)}</dd>
        </div>
        <div className="rounded-2xl bg-surface p-2.5">
          <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Minimum
          </dt>
          <dd className="font-extrabold tabular-nums">
            {formatIdr(menu.min_recovery_price_idr)} <span className="text-[11px] font-semibold text-muted-foreground">{floorPct}%</span>
          </dd>
        </div>
        <div className="rounded-2xl bg-surface p-2.5">
          <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Porsi
          </dt>
          <dd className="font-extrabold tabular-nums">{menu.portion_weight_grams} g</dd>
        </div>
      </dl>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-card text-sm font-semibold ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <PencilIcon className="size-4" /> Ubah
        </button>
        {menu.is_active ? (
          <Link
            href={`/merchant/surplus/new?menu=${menu.id}`}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Publikasikan
          </Link>
        ) : (
          <span className="inline-flex h-11 items-center justify-center rounded-2xl bg-muted text-xs font-semibold text-muted-foreground">Aktifkan untuk publikasi</span>
        )}
      </div>
    </li>
  );
}

/** /merchant/menus — menu catalogue with create/edit sheet. */
export function MerchantMenusView() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMerchantMe();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [editing, setEditing] = useState<Editing>(() => (params.get("baru") === "1" ? { mode: "create" } : null));
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const afterChange = (menu: MenuView) => {
    qc.setQueryData<MerchantMeResponse>(MERCHANT_ME_QUERY_KEY, (old) => upsertMenu(old, menu));
    void qc.invalidateQueries({ queryKey: MERCHANT_ME_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
  };

  const create = useMutation({
    mutationFn: (body: MenuCreateBody) => api.post<MenuResponse>("/merchant/menus", body),
    onSuccess: ({ menu }) => {
      afterChange(menu);
      setEditing(null);
      toast.success(`${menu.menu_name} ditambahkan`, {
        action: { label: "Publikasikan", onClick: () => router.push(`/merchant/surplus/new?menu=${menu.id}`) },
      });
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan menu.")),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: MenuUpdateBody }) => api.patch<MenuResponse>(`/merchant/menus/${id}`, body),
    onMutate: ({ id, body }) => {
      if (body.is_active === undefined) return;
      setTogglingId(id);
      qc.setQueryData<MerchantMeResponse>(MERCHANT_ME_QUERY_KEY, (old) =>
        old ? { ...old, menus: old.menus.map((m) => (m.id === id ? { ...m, is_active: Boolean(body.is_active) } : m)) } : old,
      );
    },
    onSuccess: ({ menu }, { body }) => {
      afterChange(menu);
      if (body.is_active !== undefined) {
        toast.success(menu.is_active ? `${menu.menu_name} aktif lagi` : `${menu.menu_name} dinonaktifkan`, { id: `menu-active-${menu.id}` });
      } else {
        setEditing(null);
        toast.success("Perubahan menu disimpan");
      }
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Gagal menyimpan menu."));
      void qc.invalidateQueries({ queryKey: MERCHANT_ME_QUERY_KEY });
    },
    onSettled: () => setTogglingId(null),
  });

  const menus = me.data?.menus ?? [];
  const active = menus.filter((m) => m.is_active);
  const inactive = menus.filter((m) => !m.is_active);
  const renderList = (list: MenuView[]) => (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {list.map((m) => (
        <MenuCard
          key={m.id}
          menu={m}
          toggling={togglingId === m.id}
          onEdit={() => setEditing({ mode: "edit", menu: m })}
          onToggle={(v) => update.mutate({ id: m.id, body: { is_active: v } })}
        />
      ))}
    </ul>
  );

  return (
    <MerchantPage>
      <MerchantPageHeader
        title="Menu"
        subtitle="Katalog dasar untuk publikasi surplus. Harga minimum melindungi modal kamu."
        actions={
          <button
            type="button"
            onClick={() => setEditing({ mode: "create" })}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <PlusIcon className="size-4" /> Tambah menu
          </button>
        }
      />

      {me.isPending ? (
        <ListSkeleton count={3} />
      ) : me.isError ? (
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      ) : menus.length === 0 ? (
        <div className="rounded-3xl bg-card ring-1 ring-border">
          <EmptyState icon={UtensilsCrossedIcon} title="Belum ada menu" description="Tambahkan menu yang sering tersisa, atau buat Paket Kejutan berisi campuran sisa hari itu." />
        </div>
      ) : (
        <div className="space-y-6">
          {renderList(active)}
          {inactive.length > 0 && (
            <section aria-labelledby="inactive-h">
              <h2 id="inactive-h" className="mb-2 text-sm font-semibold text-muted-foreground">
                Nonaktif ({inactive.length})
              </h2>
              {renderList(inactive)}
            </section>
          )}
        </div>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent
          side={isDesktop ? "right" : "bottom"}
          className={cn("overflow-hidden", isDesktop ? "data-[side=right]:sm:max-w-lg" : "max-h-[92dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)]")}
        >
          <SheetHeader className="px-5 pt-5 pb-0">
            <SheetTitle className="text-xl font-bold">{editing?.mode === "edit" ? "Ubah menu" : "Menu baru"}</SheetTitle>
            <SheetDescription>{editing?.mode === "edit" ? editing.menu.menu_name : "Cukup sekali. Setelah ini publikasi surplus tinggal 3 ketukan."}</SheetDescription>
          </SheetHeader>
          {/* Only the form scrolls, so the title and the close button stay in view. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            {editing && (
              <MenuForm
                key={editing.mode === "edit" ? editing.menu.id : "new"}
                defaultValues={editing.mode === "edit" ? menuToFormValues(editing.menu) : EMPTY_MENU}
                pending={create.isPending || update.isPending}
                submitLabel={editing.mode === "edit" ? "Simpan perubahan" : "Simpan menu"}
                onSubmit={(values) => {
                  if (editing.mode === "create") {
                    create.mutate(stripEmpty(values) as MenuCreateBody);
                  } else {
                    const patch = menuPatch(editing.menu, values);
                    if (Object.keys(patch).length === 0) {
                      setEditing(null);
                      return;
                    }
                    update.mutate({ id: editing.menu.id, body: patch });
                  }
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </MerchantPage>
  );
}
