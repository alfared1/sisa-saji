"use client";

/**
 * /merchant/ulasan — what buyers said: stars, hygiene and portion answers, comments, and the
 * warung's public reply under each review.
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon, MessageSquareTextIcon } from "lucide-react";
import { DemoLockNotice } from "@/components/common/demo-lock-notice";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState, errorMessage } from "@/components/common/error-state";
import { RatingStars } from "@/components/customer/bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { useNow } from "@/hooks/use-now";
import { api } from "@/lib/api/client";
import type { MerchantReviewsResponse, MerchantReviewView, ReviewReplyBody, ReviewReplyResponse } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { formatDateLabel } from "../orders/orders-view";
import { merchantKeys, useMerchantReady } from "../lib/queries";
import { MerchantPage, MerchantPageHeader } from "../ui";

type Filter = "all" | "unreplied" | "low";
const REVIEWS_STEP = 10;
const oneDecimal = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function ReplyBox({ review, locked }: { review: MerchantReviewView; locked: boolean }) {
  const qc = useQueryClient();
  const id = useId();
  const [editing, setEditing] = useState(!review.reply);
  const [text, setText] = useState(review.reply ?? "");
  const save = useMutation({
    mutationFn: (reply: string) => api.put<ReviewReplyResponse>(`/merchant/reviews/${review.id}/reply`, { reply } satisfies ReviewReplyBody),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: merchantKeys.reviewsAll });
      setEditing(!res.review.reply);
      setText(res.review.reply ?? "");
      toast.success(res.review.reply ? "Balasan tersimpan" : "Balasan dihapus", { description: res.review.reply ? "Tampil di halaman warungmu." : undefined });
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan balasan.")),
  });

  if (review.reply && !editing) {
    return (
      <div className="mt-3 rounded-xl bg-surface px-3 py-2.5 ring-1 ring-border">
        <p className="text-[11px] font-semibold text-muted-foreground">Balasanmu</p>
        <p className="mt-0.5 text-sm leading-relaxed">{review.reply}</p>
        {!locked && (
          <div className="mt-1 -ml-2 flex gap-1">
            <Button variant="ghost" className="h-9 rounded-xl px-2 text-xs font-semibold" onClick={() => setEditing(true)}>
              Ubah
            </Button>
            <Button
              variant="ghost"
              className="h-9 rounded-xl px-2 text-xs font-semibold text-urgent hover:bg-urgent-soft hover:text-urgent"
              disabled={save.isPending}
              onClick={() => save.mutate("")}
            >
              Hapus
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (locked) return null;
  return (
    <form
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) save.mutate(text.trim());
      }}
    >
      <label htmlFor={id} className="sr-only">
        Balas ulasan {review.customer_name}
      </label>
      <Textarea
        id={id}
        value={text}
        maxLength={300}
        placeholder="Balas ulasan ini, tampil di halaman warungmu"
        onChange={(e) => setText(e.target.value)}
        className="min-h-16 rounded-xl"
      />
      <div className="mt-2 flex justify-end gap-2">
        {review.reply && (
          <Button type="button" variant="ghost" className="h-10 rounded-xl" onClick={() => setEditing(false)}>
            Batal
          </Button>
        )}
        <Button type="submit" className="h-10 rounded-xl" disabled={!text.trim() || save.isPending}>
          {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
          Kirim balasan
        </Button>
      </div>
    </form>
  );
}

function ReviewCard({ r, locked, today }: { r: MerchantReviewView; locked: boolean; today: string }) {
  return (
    <li className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{r.customer_name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.menu_names.join(", ")}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <RatingStars value={r.rating} />
          <span className="text-[11px] text-muted-foreground">{formatDateLabel(wibDate(new Date(r.created_at)), today)}</span>
        </div>
      </div>
      {(r.hygiene_rating !== null || r.portion_full !== null) && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {r.hygiene_rating !== null && <span>Kebersihan {r.hygiene_rating}/5</span>}
          {r.portion_full !== null && <span>{r.portion_full ? "Porsi sesuai" : "Porsi lebih sedikit dari biasa"}</span>}
        </p>
      )}
      {r.comment && <p className="mt-2 text-sm leading-relaxed text-foreground/90">{r.comment}</p>}
      {r.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.tags.map((t) => (
            <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/75">
              {t}
            </span>
          ))}
        </div>
      )}
      <ReplyBox review={r} locked={locked} />
    </li>
  );
}

export function MerchantReviewsView() {
  const ready = useMerchantReady();
  const locked = useSession().user?.is_demo ?? false;
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(REVIEWS_STEP);
  const q = useQuery({
    queryKey: [...merchantKeys.reviews(filter), limit],
    queryFn: () => api.get<MerchantReviewsResponse>("/merchant/reviews", { filter, limit }),
    enabled: ready,
    placeholderData: (prev) => prev,
  });
  const s = q.data?.summary;
  // Client clock only after mount (prerender must not read the time).
  const now = useNow(60_000);
  const today = now !== null ? wibDate(new Date(now)) : "";

  return (
    <MerchantPage>
      <MerchantPageHeader title="Ulasan pembeli" backHref="/merchant/dashboard" subtitle="Apa kata pembeli soal rasa, kebersihan, dan porsimu." />
      {s && s.count > 0 && (
        <section aria-label="Ringkasan ulasan" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl bg-card p-3.5 ring-1 ring-border">
            <p className="text-xs font-semibold text-muted-foreground">Rating</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">{s.rating_avg !== null ? oneDecimal(s.rating_avg) : "-"}</p>
            <p className="text-xs text-muted-foreground">{s.count} ulasan</p>
          </div>
          <div className="rounded-2xl bg-card p-3.5 ring-1 ring-border">
            <p className="text-xs font-semibold text-muted-foreground">Kebersihan</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">{s.hygiene_avg !== null ? `${oneDecimal(s.hygiene_avg)}/5` : "-"}</p>
            <p className="text-xs text-muted-foreground">{s.hygiene_count} jawaban</p>
          </div>
          <div className="rounded-2xl bg-card p-3.5 ring-1 ring-border">
            <p className="text-xs font-semibold text-muted-foreground">Porsi sesuai</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">
              {s.portion_full_share !== null ? `${Math.round(s.portion_full_share * 100)}%` : "-"}
            </p>
            <p className="text-xs text-muted-foreground">{s.portion_answers} jawaban</p>
          </div>
          <div className="rounded-2xl bg-card p-3.5 ring-1 ring-border">
            <p className="text-xs font-semibold text-muted-foreground">Belum dibalas</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">{s.unreplied}</p>
            <p className="text-xs text-muted-foreground">ulasan</p>
          </div>
        </section>
      )}

      {locked && <DemoLockNotice className="mb-4" message="Akun demo: membalas ulasan dikunci karena balasan tampil untuk semua pengunjung." />}

      <Tabs
        value={filter}
        onValueChange={(v) => {
          setFilter(v as Filter);
          setLimit(REVIEWS_STEP);
        }}
      >
        <TabsList className="grid h-12! w-full grid-cols-3 rounded-2xl bg-muted p-1 sm:w-auto sm:min-w-[26rem]">
          <TabsTrigger value="all" className="h-full rounded-xl px-1 text-xs font-semibold data-active:shadow-soft sm:text-sm">
            Semua
          </TabsTrigger>
          <TabsTrigger value="unreplied" className="h-full rounded-xl px-1 text-xs font-semibold data-active:shadow-soft sm:text-sm">
            Belum dibalas
          </TabsTrigger>
          <TabsTrigger value="low" className="h-full rounded-xl px-1 text-xs font-semibold data-active:shadow-soft sm:text-sm">
            Bintang 1 sampai 3
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4" aria-live="polite">
        {q.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-36 rounded-3xl" />
            <Skeleton className="h-36 rounded-3xl" />
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : q.data.reviews.length === 0 ? (
          <div className="rounded-3xl bg-card ring-1 ring-border">
            <EmptyState
              icon={MessageSquareTextIcon}
              title={filter === "all" ? "Belum ada ulasan" : "Tidak ada ulasan di sini"}
              description={filter === "all" ? "Pembeli bisa memberi ulasan setelah pesanannya diambil." : "Coba pilih tab lain."}
            />
          </div>
        ) : (
          <>
            <ul className="grid gap-3 lg:grid-cols-2">
              {q.data.reviews.map((r) => (
                <ReviewCard key={r.id} r={r} locked={locked} today={today} />
              ))}
            </ul>
            {q.data.reviews.length >= limit && limit < 100 && (
              <Button
                variant="outline"
                className="mt-3 h-11 w-full rounded-xl font-semibold"
                disabled={q.isFetching}
                onClick={() => setLimit((n) => Math.min(100, n + REVIEWS_STEP * 2))}
              >
                Tampilkan lebih banyak
              </Button>
            )}
          </>
        )}
      </div>
    </MerchantPage>
  );
}
