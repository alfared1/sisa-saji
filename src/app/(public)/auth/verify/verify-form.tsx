"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { toast } from "sonner";
import { ChevronLeftIcon, FlaskConicalIcon, Loader2Icon, RotateCwIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { useNow } from "@/hooks/use-now";
import { useSetSessionUser } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import { OTP_LENGTH } from "@/lib/constants";
import type { OtpRequestBody, OtpRequestResponse, OtpVerifyBody, OtpVerifyResponse } from "@/lib/contracts";
import { readSession, removeSession, writeSession } from "@/lib/pwa/storage";
import { cn } from "@/lib/utils";
import {
  OTP_FLOW_KEY,
  cooldownRemaining,
  isFullNameRequired,
  maskIdentifier,
  newOtpFlow,
  parseKind,
  parseRole,
  postLoginPath,
  safeNextPath,
  type OtpFlowState,
} from "../auth-flow";

function loadFlow(identifier: string): OtpFlowState | null {
  const flow = readSession<OtpFlowState>(OTP_FLOW_KEY);
  return flow && flow.identifier === identifier ? flow : null;
}

export function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setSessionUser = useSetSessionUser();
  const identifier = params.get("id") ?? "";
  const kind = parseKind(params.get("via"));
  const role = parseRole(params.get("role"));
  const next = safeNextPath(params.get("next"));

  const [flow, setFlow] = useState<OtpFlowState | null>(null);
  const [code, setCode] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const now = useNow(1000);

  // sessionStorage is client-only: read it after mount.
  useEffect(() => {
    if (!identifier) {
      router.replace("/auth/login");
      return;
    }
    const stored = loadFlow(identifier);
    const id = requestAnimationFrame(() => setFlow(stored));
    return () => cancelAnimationFrame(id);
  }, [identifier, router]);

  const identifierBody = kind === "phone" ? { phone_number: identifier } : { email: identifier };

  const verify = useMutation({
    mutationFn: (body: OtpVerifyBody) => api.post<OtpVerifyResponse>("/auth/otp/verify", body),
    onSuccess: ({ user, is_new_user }) => {
      removeSession(OTP_FLOW_KEY);
      setSessionUser(user);
      const first = user.full_name.split(" ")[0];
      toast.success(is_new_user ? `Akun dibuat. Selamat datang, ${first}!` : `Selamat datang kembali, ${first}!`);
      router.replace(postLoginPath(user, role, next));
    },
    onError: (err) => {
      if (err instanceof ApiClientError && isFullNameRequired(err.code, err.details, err.message)) {
        setNeedsName(true);
        setError(null);
        requestAnimationFrame(() => nameRef.current?.focus());
        return;
      }
      setError(err instanceof ApiClientError ? err.message : "Verifikasi gagal. Coba lagi.");
      if (err instanceof ApiClientError && (err.code === "OTP_INVALID" || err.code === "OTP_EXPIRED")) setCode("");
    },
  });

  const resend = useMutation({
    mutationFn: () => api.post<OtpRequestResponse>("/auth/otp/request", { ...identifierBody, role } satisfies OtpRequestBody),
    onSuccess: (res) => {
      const updated = newOtpFlow({ identifier, kind, role, channel: res.channel, dev_code: res.dev_code ?? null });
      writeSession(OTP_FLOW_KEY, updated);
      setFlow(updated);
      setCode("");
      setError(null);
      toast.success(res.channel === "WHATSAPP" ? "Kode baru dikirim ke WhatsApp." : "Kode baru dikirim ke email.");
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : "Gagal mengirim ulang kode."),
  });

  const submit = (otp: string) => {
    if (otp.length !== OTP_LENGTH || verify.isPending) return;
    if (needsName && fullName.trim().length < 2) {
      setError("Isi nama lengkap minimal 2 huruf.");
      nameRef.current?.focus();
      return;
    }
    setError(null);
    verify.mutate({
      ...identifierBody,
      code: otp,
      role,
      ...(needsName ? { full_name: fullName.trim() } : {}),
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(code);
  };

  const remaining = now === null ? 0 : cooldownRemaining(flow?.sent_at ?? null, now);
  const channelLabel = kind === "phone" ? "WhatsApp" : "email";
  const backHref = `/auth/login?${new URLSearchParams({ role, via: kind, id: identifier, ...(next ? { next } : {}) }).toString()}`;

  // lg+: the form sits in a card, vertically centred by the auth layout.
  return (
    <div className="flex flex-1 flex-col gap-6 pt-2 lg:flex-none lg:rounded-[1.75rem] lg:bg-card lg:p-8 lg:shadow-card lg:ring-1 lg:ring-border">
      <Link
        href={backHref}
        className="-ml-2 inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" /> Ganti {kind === "phone" ? "nomor" : "email"}
      </Link>

      <div className="space-y-2">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-primary">
          <ShieldCheckIcon className="size-6" />
        </span>
        <h1 className="text-2xl leading-tight font-extrabold">Masukkan kode verifikasi</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Kode {OTP_LENGTH} digit sudah dikirim ke {channelLabel}{" "}
          <span className="font-semibold text-foreground tabular-nums">{maskIdentifier(identifier, kind)}</span>.
        </p>
      </div>

      {flow?.dev_code && (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-deal/50 bg-deal-soft p-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-deal text-deal-foreground">
            <FlaskConicalIcon className="size-4" />
          </span>
          <p className="min-w-0 flex-1 text-xs leading-snug">
            <span className="block font-bold text-foreground">Mode demo — kode OTP: {flow.dev_code}</span>
            <span className="text-muted-foreground">Server belum terhubung ke WhatsApp/email.</span>
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-full bg-card px-3 font-bold"
            onClick={() => {
              setCode(flow.dev_code ?? "");
              submit(flow.dev_code ?? "");
            }}
          >
            Isi kode
          </Button>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {needsName && (
          <div className="animate-float-up space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
            <Label htmlFor="full_name" className="text-sm font-semibold">
              <UserRoundIcon className="size-4 text-primary" /> Kamu pengguna baru — siapa namamu?
            </Label>
            <Input
              id="full_name"
              ref={nameRef}
              autoComplete="name"
              placeholder="Nama lengkap"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-12 rounded-2xl text-base"
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground">
              Nama dipakai di tiket pengambilan agar warung mudah mengenali pesananmu.
            </p>
          </div>
        )}

        <div className="flex justify-center">
          <InputOTP
            maxLength={OTP_LENGTH}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error) setError(null);
            }}
            onComplete={(v: string) => {
              if (!needsName) submit(v);
            }}
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Kode OTP"
            disabled={verify.isPending}
            containerClassName="gap-2"
          >
            <InputOTPGroup className="gap-2">
              {Array.from({ length: OTP_LENGTH }, (_, i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  aria-invalid={error ? true : undefined}
                  className="size-12 rounded-2xl! border bg-card text-xl font-extrabold tabular-nums shadow-soft first:border-l sm:size-14"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        {error && (
          <Alert variant="destructive" className="rounded-2xl">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          className="h-12 w-full rounded-full text-base font-bold"
          disabled={verify.isPending || code.length !== OTP_LENGTH}
        >
          {verify.isPending && <Loader2Icon className="animate-spin" />}
          {verify.isPending ? "Memverifikasi…" : needsName ? "Buat akun & masuk" : "Verifikasi & masuk"}
        </Button>
      </form>

      <div className="text-center text-sm text-muted-foreground">
        Belum menerima kode?{" "}
        <button
          type="button"
          onClick={() => resend.mutate()}
          disabled={remaining > 0 || resend.isPending}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1 font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            remaining > 0 || resend.isPending ? "text-muted-foreground" : "text-primary hover:underline",
          )}
        >
          {resend.isPending && <RotateCwIcon className="size-3.5 animate-spin" />}
          {remaining > 0 ? (
            <span className="tabular-nums">
              Kirim ulang ({Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")})
            </span>
          ) : (
            "Kirim ulang kode"
          )}
        </button>
      </div>
    </div>
  );
}
