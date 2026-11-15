"use client";

/**
 * In-app chat about one order, shared by the buyer's ticket and the warung's queue. Opens in a
 * ResponsiveSheet (bottom sheet on phones, dialog on desktop), polls while open, and offers the
 * usual pickup messages as quick replies.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon, MessageCircleIcon, SendHorizontalIcon } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetDescription,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/common/responsive-sheet";
import { Button } from "@/components/ui/button";
import { ApiClientError, api } from "@/lib/api/client";
import { ORDER_CHAT_MAX_LENGTH, ORDER_CHAT_QUICK_REPLIES } from "@/lib/constants";
import type { OrderMessage, OrderMessageResponse, OrderMessagesResponse, SendOrderMessageBody } from "@/lib/contracts";
import { formatClockId } from "@/lib/time";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;
type Side = "customer" | "merchant";

export const orderChatKey = (orderId: string, as: Side) => ["order-chat", orderId, as] as const;

/** "Chat Warung" / "Chat" button with the unread count. */
export function OrderChatButton({
  unread = 0,
  label,
  onClick,
  className,
  variant = "outline",
}: {
  unread?: number;
  label: string;
  onClick: () => void;
  className?: string;
  variant?: "outline" | "default" | "ghost";
}) {
  return (
    <Button variant={variant} className={cn("relative h-12 rounded-xl font-semibold", className)} onClick={onClick}>
      <MessageCircleIcon className={cn("size-4", variant === "outline" && "text-primary")} aria-hidden />
      {label}
      {unread > 0 && (
        <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-urgent px-1.5 text-[11px] leading-5 font-semibold text-urgent-foreground tabular-nums">
          {unread}
          <span className="sr-only"> pesan belum dibaca</span>
        </span>
      )}
    </Button>
  );
}

function Bubble({ m, showRead }: { m: OrderMessage; showRead: boolean }) {
  return (
    <li className={cn("flex flex-col", m.mine ? "items-end" : "items-start")}>
      <p
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug break-words whitespace-pre-wrap",
          m.mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {m.body}
      </p>
      <span className="mt-0.5 px-1 text-[11px] text-muted-foreground tabular-nums">
        {formatClockId(m.created_at)}
        {showRead && " · Dibaca"}
      </span>
    </li>
  );
}

export function OrderChatSheet({
  orderId,
  as,
  open,
  onOpenChange,
  title,
  description,
  onSeen,
}: {
  orderId: string;
  as: Side;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Called after the chat was read (refresh the order's unread count). */
  onSeen?: () => void;
}) {
  const qc = useQueryClient();
  const inputId = useId();
  const [text, setText] = useState("");
  const listEnd = useRef<HTMLLIElement>(null);

  const q = useQuery({
    queryKey: orderChatKey(orderId, as),
    queryFn: () => api.get<OrderMessagesResponse>(`/orders/${orderId}/messages`, { as }),
    enabled: open,
    refetchInterval: open ? POLL_MS : false,
    refetchIntervalInBackground: false,
  });

  const messages = q.data?.messages ?? [];
  const lastId = messages.at(-1)?.id;
  const fetchedAt = q.dataUpdatedAt;

  // Each fetch marks the other side's messages read on the server.
  useEffect(() => {
    if (open && fetchedAt) onSeen?.();
  }, [open, fetchedAt, onSeen]);

  useEffect(() => {
    if (open && lastId) listEnd.current?.scrollIntoView({ block: "end" });
  }, [open, lastId]);

  const send = useMutation({
    mutationFn: (body: string) =>
      api.post<OrderMessageResponse>(`/orders/${orderId}/messages`, { body, as } satisfies SendOrderMessageBody),
    onSuccess: (res) => {
      setText("");
      qc.setQueryData<OrderMessagesResponse>(orderChatKey(orderId, as), (old) =>
        old ? { ...old, messages: [...old.messages, res.message] } : old,
      );
      void qc.invalidateQueries({ queryKey: orderChatKey(orderId, as) });
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : "Pesan gagal terkirim. Coba lagi.");
      void qc.invalidateQueries({ queryKey: orderChatKey(orderId, as) });
    },
  });

  const submit = (body: string) => {
    const b = body.trim();
    if (!b || send.isPending) return;
    send.mutate(b);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(text);
  };

  const canSend = q.data?.can_send ?? false;
  const quick = ORDER_CHAT_QUICK_REPLIES[as === "merchant" ? "MERCHANT" : "CUSTOMER"];
  const lastMine = [...messages].reverse().find((m) => m.mine);

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent dialogClassName="sm:max-w-md">
        <ResponsiveSheetHeader className="text-left">
          <ResponsiveSheetTitle className="text-lg font-bold">{title}</ResponsiveSheetTitle>
          {description && <ResponsiveSheetDescription>{description}</ResponsiveSheetDescription>}
        </ResponsiveSheetHeader>

        <div className="flex max-h-[min(60vh,28rem)] min-h-48 flex-col px-4 pb-4">
          <div className="-mx-1 flex-1 overflow-y-auto px-1 py-2" aria-live="polite">
            {q.isPending ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden /> Memuat pesan…
              </div>
            ) : q.isError ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                Pesan belum bisa dimuat.
                <Button variant="outline" className="h-10 rounded-xl" onClick={() => void q.refetch()}>
                  Coba lagi
                </Button>
              </div>
            ) : messages.length === 0 ? (
              <p className="flex h-32 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {as === "merchant" ? "Belum ada pesan dari pembeli." : "Belum ada pesan. Tanyakan apa saja soal pesananmu."}
              </p>
            ) : (
              <ul className="space-y-2">
                {messages.map((m) => (
                  <Bubble key={m.id} m={m} showRead={m.id === lastMine?.id && Boolean(m.read_at)} />
                ))}
                <li ref={listEnd} aria-hidden />
              </ul>
            )}
          </div>

          {q.data && !canSend ? (
            <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
              Chat ditutup karena pesanan ini sudah selesai atau batal.
            </p>
          ) : (
            <>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Balasan cepat">
                {quick.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={send.isPending || !q.data}
                    onClick={() => submit(r)}
                    className="h-9 shrink-0 rounded-full bg-card px-3 text-xs font-semibold ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {r}
                  </button>
                ))}
              </div>
              <form onSubmit={onSubmit} className="mt-2 flex items-end gap-2">
                <label htmlFor={inputId} className="sr-only">
                  Tulis pesan
                </label>
                <textarea
                  id={inputId}
                  value={text}
                  rows={1}
                  maxLength={ORDER_CHAT_MAX_LENGTH}
                  placeholder="Tulis pesan…"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit(text);
                    }
                  }}
                  className="max-h-28 min-h-11 flex-1 resize-none rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="size-11 shrink-0 rounded-xl"
                  disabled={!text.trim() || send.isPending || !q.data}
                  aria-label="Kirim pesan"
                >
                  {send.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendHorizontalIcon aria-hidden />}
                </Button>
              </form>
            </>
          )}
        </div>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
