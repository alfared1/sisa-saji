"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "motion/react";
import {
  BellRingIcon,
  CheckIcon,
  Loader2Icon,
  MegaphoneIcon,
  PlusIcon,
  RotateCwIcon,
  TimerIcon,
  TrendingUpIcon,
  UtensilsCrossedIcon,
} from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState, errorMessage } from "@/components/common/error-state";
import { PriceTag } from "@/components/common/price-tag";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useNow } from "@/hooks/use-now";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api/client";
import type { BatchPhotoResponse, MenuView, PublishBody, PublishResponse, QuoteAiResponse } from "@/lib/contracts";
import { DEMO_MAX_BATCH_STOCK } from "@/lib/demo-accounts";
import { formatClockId, formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { BatchPhotoField, usePendingPhoto, type PendingPhoto } from "../common/photo-file-button";
import { LaukToggles } from "../common/lauk-toggles";
import { photoVisibilityText, useBatchPhotoMutations } from "../lib/batch-photo";
import { STOCK_MAX, STOCK_MIN, checkPickupEnd, clampInt, defaultPickupEnd, priceForDiscount, roundPortions } from "../lib/logic";
import { merchantKeys, useMerchantDashboard, useMerchantMe } from "../lib/queries";
import { useDebouncedValue } from "../lib/use-debounced-value";
import { MerchantPage, MerchantPageHeader, SectionCard, Stepper } from "../ui";
import { AiDiscountRecommendationCard } from "./ai-recommendation-card";
import { MenuTemplateSelector } from "./menu-template-selector";
import { PickupWindowConfirm } from "./pickup-window-confirm";

const DEFAULT_STOCK = 5;

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-extrabold text-background tabular-nums">{n}</span>
      {children}
    </span>
  );
}

type PhotoUploadState =
  | { status: "pending" }
  | { status: "done"; res: BatchPhotoResponse }
  | { status: "error"; message: string };

/** The photo picked in the publisher, uploading (or uploaded) right after the batch went live. */
function PublishedPhoto({ photo, upload, onRetry }: { photo: PendingPhoto; upload: PhotoUploadState; onRetry: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface p-3">
      {/* Local preview of the photo that was sent (blob: URL). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.previewUrl} alt="Foto etalase malam ini" className="size-16 shrink-0 rounded-xl object-cover ring-1 ring-border" />
      <div className="min-w-0 flex-1 text-sm" aria-live="polite">
        {upload.status === "pending" && (
          <p className="flex items-center gap-1.5 font-semibold">
            <Loader2Icon className="size-4 animate-spin" aria-hidden /> Mengunggah foto…
          </p>
        )}
        {upload.status === "done" && upload.res.photo && (
          <>
            <p className="font-semibold">Foto terunggah pukul {formatClockId(upload.res.photo.uploaded_at)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{photoVisibilityText(upload.res.photo)}</p>
          </>
        )}
        {upload.status === "error" && (
          <>
            <p className="font-semibold text-urgent">Foto belum terunggah</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{upload.message} Surplusnya tetap tayang.</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <RotateCwIcon className="size-4" aria-hidden /> Unggah ulang foto
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PublishSuccess({
  result,
  seconds,
  onAnother,
  photo,
}: {
  result: PublishResponse;
  seconds: number | null;
  onAnother: () => void;
  photo: { pending: PendingPhoto; upload: PhotoUploadState; onRetry: () => void } | null;
}) {
  const b = result.batch;
  return (
    <MerchantPage className="mx-auto max-w-xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex flex-col items-center pt-6 text-center"
        role="status"
      >
        <div className="relative">
          <motion.span
            className="absolute inset-0 rounded-full bg-primary/25"
            initial={{ scale: 0.6, opacity: 0.8 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1.2, repeat: 2 }}
            aria-hidden
          />
          <motion.span
            initial={{ scale: 0.4 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="relative inline-flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <CheckIcon className="size-10" strokeWidth={3} />
          </motion.span>
        </div>
        <h1 className="mt-6 text-2xl font-bold">Surplus sudah tayang</h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <BellRingIcon className="size-4 text-deal" aria-hidden />
          {result.notified_devices > 0 ? (
            <span>
              <b className="text-foreground tabular-nums">{result.notified_devices}</b> perangkat di sekitar diberi notifikasi
            </span>
          ) : (
            <span>Tampil untuk mahasiswa dalam radius 2 km</span>
          )}
        </p>
        {seconds !== null && seconds < 600 && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-primary">
            <TimerIcon className="size-3.5" aria-hidden /> Dipublikasikan dalam {seconds} detik
          </p>
        )}
      </motion.div>

      <div className="mt-6 rounded-3xl bg-card p-4 text-left shadow-card ring-1 ring-border sm:p-5">
        <p className="text-xs font-semibold text-muted-foreground">Sedang tayang</p>
        <h2 className="mt-0.5 text-lg font-bold">{b.menu_name}</h2>
        <PriceTag className="mt-1" original={b.original_price_idr} selling={b.current_selling_price_idr} discountPct={b.current_discount_pct} endIso={b.pickup_end_time} size="lg" />
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Stok</dt>
            <dd className="text-lg font-extrabold tabular-nums">{b.available_stock} porsi</dd>
          </div>
          <div className="rounded-2xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Batas ambil</dt>
            <dd className="text-lg font-extrabold tabular-nums">{formatClockId(b.pickup_end_time)} WIB</dd>
          </div>
        </dl>
        {b.lauk_options.length > 0 && (
          <p className="mt-3 text-sm">
            <span className="font-semibold">Lauk malam ini:</span> {b.lauk_available.join(", ")}
          </p>
        )}
        {!b.full_portion && <p className="mt-1 text-sm text-muted-foreground">Pembeli melihat: porsi lebih kecil dari biasa.</p>}
        {b.auto_discount_enabled && b.next_escalation && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-deal-soft/70 px-3 py-2 text-xs font-semibold text-deal">
            <TrendingUpIcon className="size-4" aria-hidden /> Auto-diskon: naik ke {b.next_escalation.discount_pct}% pukul {formatClockId(b.next_escalation.at)}
          </p>
        )}
        {photo && <PublishedPhoto photo={photo.pending} upload={photo.upload} onRetry={photo.onRetry} />}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <Link
          href="/merchant/dashboard"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-card"
        >
          Kembali ke dasbor
        </Link>
        <button
          type="button"
          onClick={onAnother}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-card px-5 text-sm font-semibold ring-1 ring-border hover:bg-muted"
        >
          <PlusIcon className="size-4" /> Publikasikan menu lain
        </button>
      </div>
    </MerchantPage>
  );
}

/**
 * Under the chosen menu: its fixed contents (read-only) and tonight's lauk toggles. A menu
 * created before contents existed still publishes; the warung is nudged to list them.
 */
function MenuTonight({ menu, lauk, onLaukChange }: { menu: MenuView; lauk: string[]; onLaukChange: (lauk: string[]) => void }) {
  const headingId = `lauk-${menu.id}`;
  const listed = menu.contents.length > 0 || menu.lauk_options.length > 0;
  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      {menu.contents.length > 0 ? (
        <p className="text-sm">
          <span className="font-semibold">Isi porsi:</span> <span className="text-muted-foreground">{menu.contents.join(", ")}</span>
        </p>
      ) : !listed ? (
        <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-foreground">
          Lengkapi isi porsi menu ini dulu supaya pembeli tahu isinya.{" "}
          <Link href="/merchant/menus" className="font-semibold text-primary underline-offset-2 hover:underline">
            Buka halaman Menu
          </Link>
        </p>
      ) : null}
      {menu.lauk_options.length > 0 && (
        <div>
          <h3 id={headingId} className="text-sm font-semibold">
            Lauk yang masih ada malam ini
          </h3>
          <p className="mt-0.5 mb-2.5 text-xs text-muted-foreground">Matikan lauk yang sudah habis. Minimal satu tetap menyala.</p>
          <LaukToggles options={menu.lauk_options} value={lauk} onChange={onLaukChange} labelledBy={headingId} />
        </div>
      )}
    </div>
  );
}

function PublisherSkeleton() {
  return (
    <MerchantPage>
      <Skeleton className="mb-5 h-10 w-64" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Skeleton className="h-52 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
        </div>
        <Skeleton className="h-[30rem] rounded-3xl" />
      </div>
    </MerchantPage>
  );
}

/** /merchant/surplus/new — AI-Assisted Quick Surplus Publisher (target: < 60 s). */
export function SurplusPublisherView() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const me = useMerchantMe();
  const dash = useMerchantDashboard();
  const now = useNow(15_000);

  const [menuChoice, setMenuChoice] = useState<string | null>(null);
  const [stockChoice, setStockChoice] = useState<number | null>(null);
  const [endChoice, setEndChoice] = useState<number | null>(null);
  const [autoEscalation, setAutoEscalation] = useState(true);
  const [override, setOverride] = useState<number | null>(null);
  const [published, setPublished] = useState<{ result: PublishResponse; seconds: number | null } | null>(null);
  // Tonight's lauk per menu (all on until the warung switches one off) and the portion promise.
  const [laukChoice, setLaukChoice] = useState<{ menuId: string; lauk: string[] } | null>(null);
  const [fullPortion, setFullPortion] = useState(true);
  // The optional photo is compressed when picked and uploaded only after publishing.
  const [photo, setPhoto] = usePendingPhoto();
  const [photoUpload, setPhotoUpload] = useState<PhotoUploadState | null>(null);
  const { upload: uploadPhoto } = useBatchPhotoMutations();
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const menus = useMemo(() => (me.data?.menus ?? []).filter((m) => m.is_active), [me.data?.menus]);
  const predicted = useMemo(
    () => new Map((dash.data?.ai_prediction?.per_menu ?? []).map((p) => [p.menu_id, p.predicted_surplus_portions] as const)),
    [dash.data?.ai_prediction?.per_menu],
  );
  const liveMenuIds = useMemo(
    () => new Set((dash.data?.active_batches ?? []).filter((b) => b.status === "ACTIVE" || b.status === "SCHEDULED").map((b) => b.menu_id)),
    [dash.data?.active_batches],
  );

  // Derived selection: explicit choice → ?menu= → top predicted menu not yet live → first.
  const paramMenu = params.get("menu");
  const menuId =
    (menuChoice && menus.some((m) => m.id === menuChoice) ? menuChoice : null) ??
    (paramMenu && menus.some((m) => m.id === paramMenu) ? paramMenu : null) ??
    [...menus].sort(
      (a, b) =>
        Number(liveMenuIds.has(a.id)) - Number(liveMenuIds.has(b.id)) || (predicted.get(b.id) ?? 0) - (predicted.get(a.id) ?? 0),
    )[0]?.id ??
    null;
  const menu = menus.find((m) => m.id === menuId) ?? null;
  const predictedForMenu = menuId ? predicted.get(menuId) : undefined;
  const laukAvailable = menu ? (laukChoice?.menuId === menu.id ? laukChoice.lauk : menu.lauk_options) : [];
  const isDemo = useSession().user?.is_demo ?? false;
  const isPilot = me.data?.merchant.is_pilot ?? false;
  // The shared demo warung publishes at most DEMO_MAX_BATCH_STOCK portions per batch (server rule).
  const stockMax = isDemo ? DEMO_MAX_BATCH_STOCK : STOCK_MAX;
  const stock = Math.min(
    stockChoice ?? clampInt(predictedForMenu && predictedForMenu >= 1 ? roundPortions(predictedForMenu) : DEFAULT_STOCK, STOCK_MIN, stockMax),
    stockMax,
  );
  const closeTime = me.data?.merchant.operational_close_time ?? "22:00";
  const endMs = endChoice ?? (now !== null ? defaultPickupEnd(closeTime, now).endMs : null);
  const windowCheck = endMs !== null && now !== null ? checkPickupEnd(endMs, now) : null;
  const endIso = endMs !== null ? new Date(endMs).toISOString() : null;

  // Debounce a primitive key (300 ms) so typing / tapping +/- doesn't flood quote-ai.
  const liveKey = menuId && endIso && windowCheck?.ok ? `${menuId}|${stock}|${endIso}` : null;
  const settledKey = useDebouncedValue(liveKey, 300);
  const quoteInput = useMemo(() => {
    if (!settledKey) return null;
    const [menu_id, s, pickup_end_time] = settledKey.split("|");
    return { menu_id, available_stock: Number(s), pickup_end_time };
  }, [settledKey]);

  const quote = useQuery({
    queryKey: ["merchant", "quote", quoteInput],
    queryFn: () => api.post<QuoteAiResponse>("/merchant/surplus/quote-ai", quoteInput),
    enabled: quoteInput !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
  // Drop a stale quote from another menu (prices differ per menu).
  const shownQuote = quote.data && quote.data.menu_id === menuId ? quote.data : undefined;
  const settling = settledKey !== liveKey;

  const publish = useMutation({
    mutationFn: (body: PublishBody) => api.post<PublishResponse>("/merchant/surplus/publish", body),
    onSuccess: (res) => {
      const seconds = startedAt.current ? Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)) : null;
      setPublished({ result: res, seconds });
      void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
      toast.success(`${res.batch.menu_name} tayang!`, {
        description: res.notified_devices > 0 ? `${res.notified_devices} perangkat di sekitar diberi notifikasi.` : "Listing tampil di peta & beranda pembeli.",
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mempublikasikan surplus.")),
  });

  const startPhotoUpload = (batchId: string, pending: PendingPhoto) => {
    setPhotoUpload({ status: "pending" });
    uploadPhoto.mutate(
      { batchId, jpeg: pending.jpeg },
      {
        onSuccess: (res) => setPhotoUpload({ status: "done", res }),
        onError: (err) => setPhotoUpload({ status: "error", message: errorMessage(err, "Koneksi terputus.") }),
      },
    );
  };

  if (published) {
    const batchId = published.result.batch.id;
    return (
      <PublishSuccess
        result={published.result}
        seconds={published.seconds}
        photo={
          photo && photoUpload
            ? { pending: photo, upload: photoUpload, onRetry: () => startPhotoUpload(batchId, photo) }
            : null
        }
        onAnother={() => {
          setPublished(null);
          setMenuChoice(null);
          setStockChoice(null);
          setEndChoice(null);
          setOverride(null);
          setAutoEscalation(true);
          setLaukChoice(null);
          setFullPortion(true);
          setPhoto(null);
          setPhotoUpload(null);
          startedAt.current = Date.now();
          publish.reset();
          uploadPhoto.reset();
        }}
      />
    );
  }

  if (me.isPending) return <PublisherSkeleton />;
  if (me.isError) {
    return (
      <MerchantPage>
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </MerchantPage>
    );
  }

  if (menus.length === 0) {
    return (
      <MerchantPage>
        <MerchantPageHeader title="Publikasi surplus" backHref="/merchant/dashboard" />
        <div className="rounded-3xl bg-card ring-1 ring-border">
          <EmptyState
            icon={UtensilsCrossedIcon}
            title="Belum ada menu aktif"
            description="Tambahkan menu beserta isi porsinya dulu. Setelah itu publikasi surplus cukup 3 ketukan."
            action={
              <Link href="/merchant/menus?baru=1" className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground">
                <PlusIcon className="size-4" /> Tambah menu
              </Link>
            }
          />
        </div>
      </MerchantPage>
    );
  }

  const disabledReason = !menuId ? "Pilih menu dulu." : windowCheck && !windowCheck.ok ? `${windowCheck.message} Atur batas ambil untuk melihat saran harga.` : null;
  const effectivePrice =
    shownQuote && override !== null
      ? priceForDiscount(shownQuote.original_price_idr, shownQuote.min_recovery_price_idr, override).sellingPriceIdr
      : shownQuote?.recommended_selling_price_idr;
  const canPublish = Boolean(menuId && endIso && windowCheck?.ok && !publish.isPending);

  const submit = () => {
    if (!menuId || !endIso || !canPublish) return;
    const body: PublishBody = {
      menu_id: menuId,
      initial_stock: stock,
      pickup_end_time: endIso,
      auto_discount_enabled: autoEscalation,
      full_portion: fullPortion,
    };
    if (menu && menu.lauk_options.length > 0) body.lauk_available = laukAvailable;
    if (override !== null) body.discount_pct_override = override;
    const pending = photo;
    publish.mutate(body, {
      onSuccess: (res) => {
        if (pending) startPhotoUpload(res.batch.id, pending);
      },
    });
  };

  const publishButton = (
    <button
      type="button"
      onClick={submit}
      disabled={!canPublish}
      className="flex h-16 w-full items-center justify-between gap-3 rounded-2xl bg-primary pr-3 pl-5 text-left text-primary-foreground shadow-card transition-transform outline-none active:scale-[0.99] focus-visible:ring-4 focus-visible:ring-ring/50 disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block text-base leading-tight font-semibold">{publish.isPending ? "Mempublikasikan…" : "Publikasikan Sekarang"}</span>
        {/* Only the menu name truncates; the price stays whole. */}
        <span className="flex min-w-0 gap-1 text-xs font-semibold text-primary-foreground/85 tabular-nums">
          <span className="truncate">{menu ? `${stock} porsi ${menu.menu_name}` : "Pilih menu"}</span>
          {effectivePrice !== undefined && <span className="shrink-0">· {formatIdr(effectivePrice)}</span>}
        </span>
      </span>
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
        {publish.isPending ? <Loader2Icon className="size-5 animate-spin" /> : <MegaphoneIcon className="size-5" />}
      </span>
    </button>
  );

  return (
    <MerchantPage className="pb-32 lg:pb-8">
      <MerchantPageHeader
        backHref="/merchant/dashboard"
        title="Publikasi surplus"
        subtitle="Pilih menu, isi jumlah porsi, cek saran harga. Selesai dalam 60 detik."
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          <SectionCard title={<StepLabel n={1}>Menu apa yang tersisa?</StepLabel>}>
            <MenuTemplateSelector
              menus={menus}
              value={menuId}
              onChange={(id) => {
                setMenuChoice(id);
                setStockChoice(null);
                setOverride(null);
              }}
              predicted={predicted}
              liveMenuIds={liveMenuIds}
            />
            {menu && (
              <MenuTonight menu={menu} lauk={laukAvailable} onLaukChange={(lauk) => setLaukChoice({ menuId: menu.id, lauk })} />
            )}
          </SectionCard>

          <SectionCard
            title={<StepLabel n={2}>Berapa porsi?</StepLabel>}
            description={
              predictedForMenu && stockChoice === null
                ? `Diisi dari perkiraan porsi sisa malam ini (±${roundPortions(predictedForMenu)} porsi). Ubah bila perlu.`
                : "Jumlah porsi siap dijual malam ini."
            }
          >
            <div className="mx-auto max-w-sm py-1">
              <Stepper value={stock} onChange={setStockChoice} min={STOCK_MIN} max={stockMax} label="Jumlah porsi" unit="porsi" />
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2" role="group" aria-label="Pilih cepat jumlah porsi">
              {[3, 5, 10, 15, 20].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setStockChoice(n)}
                  aria-pressed={stock === n}
                  className={cn(
                    "h-10 min-w-12 rounded-full px-3 text-sm font-semibold tabular-nums ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    stock === n ? "bg-foreground text-background ring-foreground" : "bg-card ring-border hover:bg-muted",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={<StepLabel n={3}>Sampai jam berapa bisa diambil?</StepLabel>}>
            <PickupWindowConfirm endMs={endMs} nowMs={now} closeTime={closeTime} onChange={setEndChoice} />
          </SectionCard>

          <SectionCard title="Info untuk pembeli" description="Sudah terisi. Ubah bila malam ini berbeda.">
            <label className="flex cursor-pointer items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Porsi sama dengan porsi normal</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  Matikan bila porsi malam ini lebih kecil. Pembeli akan melihatnya.
                </span>
              </span>
              <Switch checked={fullPortion} onCheckedChange={setFullPortion} aria-label="Porsi sama dengan porsi normal" className="mt-1" />
            </label>
            <div className="mt-4 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">
                Foto etalase malam ini <span className="font-normal text-muted-foreground">(opsional)</span>
              </h3>
              <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Diunggah setelah surplus tayang, jadi publikasi tidak menunggu foto.</p>
              <BatchPhotoField value={photo} onChange={setPhoto} isDemo={isDemo} isPilot={isPilot} />
            </div>
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-6">
          <AiDiscountRecommendationCard
            quote={shownQuote}
            isFetching={quote.isFetching || (settling && !disabledReason)}
            error={quote.error}
            onRetry={() => void quote.refetch()}
            disabledReason={disabledReason}
            override={override}
            onOverrideChange={setOverride}
            endIso={endIso}
          />

          <label className="flex cursor-pointer items-start gap-3 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-deal-soft text-deal">
              <TrendingUpIcon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Aktifkan Auto-Escalation Diskon</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                Diskon naik otomatis hingga 70% bila 30 menit sebelum tutup masih tersisa ≥ 5 porsi. Tidak pernah di bawah harga minimum.
              </span>
            </span>
            <Switch checked={autoEscalation} onCheckedChange={setAutoEscalation} aria-label="Aktifkan Auto-Escalation Diskon" className="mt-1" />
          </label>

          <div className="hidden lg:block">{publishButton}</div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-border/60 bg-background/90 px-4 py-2.5 backdrop-blur-xl lg:hidden">
        <div className="mx-auto max-w-2xl">{publishButton}</div>
      </div>
    </MerchantPage>
  );
}
