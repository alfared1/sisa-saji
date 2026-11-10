"use client";

/**
 * COMPLETED: ThankyouScreen (impact infographic + share), ImpactCelebrationModal
 * (confetti motion) and ReviewFormSheet → POST /orders/:id/review.
 */
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  CloudIcon,
  LeafIcon,
  Loader2Icon,
  MessageSquareHeartIcon,
  PartyPopperIcon,
  Share2Icon,
  StarIcon,
  TreesIcon,
  WalletIcon,
} from "lucide-react";
import { LogoMark } from "@/components/common/logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  RESPONSIVE_SHEET_DESKTOP_QUERY,
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetDescription,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/common/responsive-sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, api } from "@/lib/api/client";
import type { OrderDetail, OrderResponse, ReviewBody } from "@/lib/contracts";
import { formatKg, treeYearsFromCo2Grams } from "@/lib/impact";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { RatingStars } from "../bits";
import { impactShareText } from "../lib/checkout-logic";
import { formatDateTimeId, formatDecimal } from "../lib/format";
import { PICKUP_TAGS, RATING_COPY } from "../lib/order-status";
import { customerKeys } from "../lib/queries";
import { OrderItemsCard } from "./order-bits";

/* ------------------------------ Share ------------------------------ */

async function shareImpact(order: OrderDetail) {
  const text = impactShareText({
    foodKg: formatKg(order.food_saved_grams),
    co2Kg: formatKg(order.co2_avoided_grams),
    saved: formatIdr(order.money_saved_idr),
    merchant: order.merchant.name,
  });
  const url = `${window.location.origin}/welcome`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Dampak Sisa-Saji", text, url });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast.success("Teks dampak disalin", { description: "Tempel di Instagram Story atau WhatsApp." });
  } catch {
    toast.error("Tidak bisa membagikan dari browser ini.");
  }
}

/* --------------------------- Impact infographic --------------------------- */

function ImpactInfographic({ order }: { order: OrderDetail }) {
  const trees = treeYearsFromCo2Grams(order.co2_avoided_grams);
  const stats = [
    { icon: LeafIcon, value: formatKg(order.food_saved_grams), label: "pangan diselamatkan" },
    { icon: CloudIcon, value: formatKg(order.co2_avoided_grams), label: "CO₂e dicegah" },
    { icon: WalletIcon, value: formatIdr(order.money_saved_idr), label: "uang dihemat" },
    { icon: TreesIcon, value: `${formatDecimal(trees * 12, 1)} bln`, label: "kerja 1 pohon menyerap CO₂" },
  ];
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-primary via-brand-strong to-emerald-900 p-5 text-white shadow-float dark:from-emerald-800 dark:via-emerald-700 dark:to-emerald-900">
      <span className="absolute -top-12 -right-10 size-44 rounded-full bg-white/10" aria-hidden />
      <span className="absolute -bottom-16 -left-10 size-40 rounded-full bg-white/5" aria-hidden />
      <div className="relative flex items-center gap-2">
        <LogoMark className="size-8" />
        <p className="text-xs font-bold text-white/85">Dampak pesanan {order.order_number}</p>
      </div>
      <p className="relative mt-3 text-xl leading-snug font-extrabold text-balance">
        Kamu menyelamatkan {formatKg(order.food_saved_grams)} makanan dari {order.merchant.name}!
      </p>
      <div className="relative mt-4 grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl bg-white/12 p-3 ring-1 ring-white/15">
            <s.icon className="size-4 opacity-90" aria-hidden />
            <p className="mt-1.5 text-lg leading-tight font-extrabold tabular-nums">{s.value}</p>
            <p className="text-[11px] leading-tight text-white/80">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------- Confetti ------------------------------- */

const CONFETTI_COLORS = ["#16a34a", "#f97316", "#facc15", "#ef4444", "#22c55e", "#0ea5e9"];
/** Deterministic pseudo-random in [0,1) so renders stay pure. */
const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function Confetti() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 36 }, (_, i) => (
        <motion.span
          key={i}
          className="absolute top-0 block rounded-[2px]"
          style={{
            left: `${rnd(i, 1) * 100}%`,
            width: 6 + rnd(i, 2) * 6,
            height: 10 + rnd(i, 3) * 8,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          }}
          initial={{ y: -30, rotate: 0, opacity: 1 }}
          animate={{ y: 520, rotate: (rnd(i, 4) - 0.5) * 720, x: (rnd(i, 5) - 0.5) * 120, opacity: [1, 1, 0] }}
          transition={{ duration: 2.2 + rnd(i, 6) * 1.4, delay: rnd(i, 7) * 0.6, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}

export function ImpactCelebrationModal({
  order,
  open,
  onOpenChange,
  onReview,
}: {
  order: OrderDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onReview: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] overflow-hidden rounded-[1.75rem] p-0 sm:max-w-sm">
        <div className="relative bg-gradient-to-b from-brand-soft to-card px-6 pt-8 pb-6 text-center">
          {open && <Confetti />}
          <motion.span
            initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 14 }}
            className="relative mx-auto inline-flex size-20 items-center justify-center rounded-[1.75rem] bg-primary text-primary-foreground shadow-float"
          >
            <PartyPopperIcon className="size-10" />
          </motion.span>
          <DialogTitle className="relative mt-5 text-2xl font-extrabold">Pesanan selesai!</DialogTitle>
          <DialogDescription className="relative mt-1 text-sm leading-relaxed">
            Terima kasih sudah menyelamatkan makanan dari {order.merchant.name}.
          </DialogDescription>
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="relative mt-5 grid grid-cols-3 gap-2"
          >
            {[
              { v: formatKg(order.food_saved_grams), l: "pangan" },
              { v: formatKg(order.co2_avoided_grams), l: "CO₂e" },
              { v: formatIdr(order.money_saved_idr), l: "dihemat" },
            ].map((s) => (
              <div key={s.l} className="min-w-0 rounded-2xl bg-card p-2.5 shadow-soft ring-1 ring-border">
                <p className="truncate text-sm font-extrabold text-primary tabular-nums">{s.v}</p>
                <p className="text-[11px] text-muted-foreground">{s.l}</p>
              </div>
            ))}
          </motion.div>
          <div className="relative mt-5 grid gap-2">
            {!order.review && (
              <Button
                className="h-12 rounded-full text-base font-bold"
                onClick={() => {
                  onOpenChange(false);
                  onReview();
                }}
              >
                <StarIcon className="size-4" /> Beri ulasan
              </Button>
            )}
            <Button variant="outline" className="h-11 rounded-full font-bold" onClick={() => void shareImpact(order)}>
              <Share2Icon className="size-4" /> Bagikan dampakku
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Review ------------------------------- */

export function ReviewFormSheet({
  order,
  open,
  onOpenChange,
}: {
  order: OrderDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");

  const submit = useMutation({
    mutationFn: (body: ReviewBody) => api.post<OrderResponse>(`/orders/${order.id}/review`, body),
    onSuccess: ({ order: o }) => {
      qc.setQueryData(customerKeys.order(o.id), { order: o });
      void qc.invalidateQueries({ queryKey: customerKeys.ordersAll });
      void qc.invalidateQueries({ queryKey: customerKeys.warung(o.merchant.slug) });
      onOpenChange(false);
      toast.success("Terima kasih atas ulasanmu!", { description: "Ulasanmu membantu warung dan pembeli lain." });
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Gagal mengirim ulasan."),
  });

  // Phones keep the vaul sheet exactly as before (incl. repositionInputs={false});
  // lg+ shows the same form in a centred dialog via <ResponsiveSheet>.
  const desktop = useMediaQuery(RESPONSIVE_SHEET_DESKTOP_QUERY);
  const form = (
        <form
          className="space-y-5 overflow-y-auto px-4 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (rating < 1) return;
            submit.mutate({ rating, tags, comment: comment.trim() || undefined });
          }}
        >
          <div className="text-center">
            <div role="radiogroup" aria-label="Rating" className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={rating === i}
                  aria-label={`${i} bintang`}
                  onClick={() => setRating(i)}
                  className="inline-flex size-12 items-center justify-center rounded-full transition-transform outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90"
                >
                  <StarIcon
                    className={cn(
                      "size-9 transition-colors",
                      i <= rating ? "fill-amber-400 text-amber-400" : "fill-muted text-muted-foreground/30",
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="mt-1 h-5 text-sm font-bold text-amber-600">{RATING_COPY[rating]}</p>
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Apa yang kamu suka?
            </legend>
            <div className="flex flex-wrap gap-2">
              {PICKUP_TAGS.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTags((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
                    className={cn(
                      "h-10 rounded-full px-3.5 text-sm font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      on ? "bg-primary text-primary-foreground ring-primary" : "bg-card ring-border hover:bg-muted",
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="review-comment" className="mb-2 block text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Cerita singkat (opsional)
            </label>
            <Textarea
              id="review-comment"
              value={comment}
              maxLength={500}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Porsinya pas, masih hangat waktu diambil…"
              className="min-h-24 rounded-2xl text-base"
            />
          </div>

          <Button type="submit" className="h-12 w-full rounded-full text-base font-bold" disabled={rating < 1 || submit.isPending}>
            {submit.isPending && <Loader2Icon className="size-4 animate-spin" />}
            {rating < 1 ? "Pilih bintang dulu" : "Kirim ulasan"}
          </Button>
        </form>
  );

  if (desktop) {
    return (
      <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
        <ResponsiveSheetContent>
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle className="text-lg font-bold">Gimana pesananmu?</ResponsiveSheetTitle>
            <ResponsiveSheetDescription>{order.merchant.name}</ResponsiveSheetDescription>
          </ResponsiveSheetHeader>
          {form}
        </ResponsiveSheetContent>
      </ResponsiveSheet>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="mx-auto max-w-md rounded-t-3xl">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-lg font-bold">Gimana pesananmu?</DrawerTitle>
          <DrawerDescription>{order.merchant.name}</DrawerDescription>
        </DrawerHeader>
        {form}
      </DrawerContent>
    </Drawer>
  );
}

/* ------------------------------ Thank-you ------------------------------ */

export function CompletedView({ order, onReview }: { order: OrderDetail; onReview: () => void }) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-10 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start lg:gap-6 lg:pt-6">
      {/* lg+: primary column (display:contents on phones keeps the single flex column). */}
      <div className="contents lg:flex lg:flex-col lg:gap-4">
      <ImpactInfographic order={order} />
      <Button variant="outline" className="h-12 rounded-full font-bold" onClick={() => void shareImpact(order)}>
        <Share2Icon className="size-4" /> Bagikan ke Instagram Story / WhatsApp
      </Button>

      {order.review ? (
        <section className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
          <h2 className="text-sm font-extrabold">Ulasanmu</h2>
          <RatingStars value={order.review.rating} className="mt-2 [&_svg]:size-5" />
          {order.review.comment && <p className="mt-2 text-sm leading-relaxed">{order.review.comment}</p>}
          {order.review.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {order.review.tags.map((t) => (
                <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
                  {t}
                </span>
              ))}
            </div>
          )}
        </section>
      ) : (
        <button
          type="button"
          onClick={onReview}
          className="flex items-center gap-3 rounded-3xl bg-warning-soft p-4 text-left ring-1 ring-warning/30 transition-transform outline-none active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-card text-amber-500 shadow-soft">
            <MessageSquareHeartIcon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold text-balance">Beri ulasan untuk {order.merchant.name}</span>
            <span className="block text-xs text-pretty text-muted-foreground">Cuma 10 detik — bantu warung makin dipercaya.</span>
          </span>
          <StarIcon className="size-5 fill-amber-400 text-amber-400" />
        </button>
      )}
      </div>

      {/* lg+: sticky details column. */}
      <div className="contents lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-4">
      <OrderItemsCard order={order} />
      {order.picked_up_at && (
        <p className="text-center text-xs text-muted-foreground">Diambil {formatDateTimeId(order.picked_up_at)} WIB</p>
      )}
      <Button asChild className="h-12 rounded-full font-bold">
        <Link href="/discover">Selamatkan makanan lagi</Link>
      </Button>
      </div>
    </div>
  );
}
