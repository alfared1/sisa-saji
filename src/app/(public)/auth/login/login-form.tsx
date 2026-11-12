"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDemoLogin } from "@/hooks/use-demo-login";
import { useGlobalStats } from "@/hooks/use-global-stats";
import { ApiClientError, api } from "@/lib/api/client";
import { OtpRequestBody, type OtpRequestResponse } from "@/lib/contracts";
import { writeSession } from "@/lib/pwa/storage";
import { cn } from "@/lib/utils";
import {
  OTP_FLOW_KEY,
  newOtpFlow,
  normalisePhoneInput,
  parseKind,
  parseRole,
  postLoginPath,
  safeNextPath,
  type AuthRole,
  type IdentifierKind,
} from "../auth-flow";

const COPY: Record<AuthRole, { title: string; subtitle: string }> = {
  CUSTOMER: {
    title: "Masuk untuk pesan porsi malam ini",
    subtitle: "Tanpa kata sandi. Kami kirim kode 6 digit untuk verifikasi.",
  },
  MERCHANT: {
    title: "Masuk sebagai Mitra Warung",
    subtitle: "Publikasikan porsi surplus dalam 60 detik dan pantau pesanan masuk.",
  },
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [role, setRole] = useState<AuthRole>(() => parseRole(params.get("role")));
  const [kind, setKind] = useState<IdentifierKind>(() => parseKind(params.get("via")));
  const [value, setValue] = useState(() => params.get("id") ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const next = safeNextPath(params.get("next"));
  // The one-tap demo account exists only while the app runs on demo data.
  const demo = useGlobalStats().data?.is_demo_data ?? false;
  const demoLogin = useDemoLogin((user, r) => router.replace(postLoginPath(user, r, next)));

  const request = useMutation({
    mutationFn: (body: OtpRequestBody) => api.post<OtpRequestResponse>("/auth/otp/request", body),
  });

  const switchRole = (r: string) => {
    setRole(parseRole(r));
    request.reset();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    const identifier = kind === "phone" ? normalisePhoneInput(value) : value.trim().toLowerCase();
    const body: OtpRequestBody = kind === "phone" ? { phone_number: identifier, role } : { email: identifier, role };
    const parsed = OtpRequestBody.safeParse(body);
    if (!parsed.success) {
      setFieldError(
        kind === "phone" ? "Nomor HP tidak valid. Contoh: 081234567890" : "Alamat email tidak valid.",
      );
      return;
    }
    request.mutate(body, {
      onSuccess: (res) => {
        writeSession(
          OTP_FLOW_KEY,
          newOtpFlow({ identifier, kind, role, channel: res.channel, dev_code: res.dev_code ?? null }),
        );
        const q = new URLSearchParams({ id: identifier, via: kind, role });
        if (next) q.set("next", next);
        router.push(`/auth/verify?${q.toString()}`);
      },
    });
  };

  const apiError = request.error instanceof ApiClientError ? request.error.message : request.error ? "Gagal mengirim kode." : null;
  const copy = COPY[role];

  // lg+: the form sits in a card, vertically centred by the auth layout.
  return (
    <div className="flex flex-1 flex-col gap-6 pt-2 lg:flex-none lg:rounded-3xl lg:bg-card lg:p-8 lg:shadow-card lg:ring-1 lg:ring-border">
      <Tabs value={role} onValueChange={switchRole}>
        <TabsList className="grid h-12! w-full grid-cols-2 rounded-2xl bg-muted p-1">
          <TabsTrigger value="CUSTOMER" className="h-full rounded-xl text-sm font-semibold data-active:shadow-soft">
            Pembeli
          </TabsTrigger>
          <TabsTrigger value="MERCHANT" className="h-full rounded-xl text-sm font-semibold data-active:shadow-soft">
            Mitra Warung
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-2">
        <h1 className="text-2xl leading-tight font-bold">{copy.title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{copy.subtitle}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div
          role="radiogroup"
          aria-label="Masuk dengan"
          className="inline-flex rounded-full bg-card p-1 ring-1 ring-border"
        >
          {(
            [
              { k: "phone", label: "Nomor HP" },
              { k: "email", label: "Email" },
            ] as const
          ).map(({ k, label }) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                setValue("");
                setFieldError(null);
                request.reset();
              }}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                kind === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="identifier" className="text-sm font-semibold">
            {kind === "phone" ? "Nomor WhatsApp" : "Alamat email"}
          </Label>
          <div className="relative">
            <Input
              id="identifier"
              name={kind === "phone" ? "tel" : "email"}
              type={kind === "phone" ? "tel" : "email"}
              inputMode={kind === "phone" ? "tel" : "email"}
              autoComplete={kind === "phone" ? "tel" : "email"}
              autoFocus
              placeholder={kind === "phone" ? "Contoh: 0812 3456 7890" : "Contoh: nama@kampus.ac.id"}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (fieldError) setFieldError(null);
              }}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "identifier-error" : "identifier-hint"}
              className={cn("h-12 rounded-xl bg-card text-base", kind === "phone" && "tabular-nums")}
            />
          </div>
          {fieldError ? (
            <p id="identifier-error" className="text-xs font-medium text-destructive">
              {fieldError}
            </p>
          ) : (
            <p id="identifier-hint" className="text-xs text-muted-foreground">
              {kind === "phone" ? "Kode dikirim lewat WhatsApp." : "Kode dikirim ke kotak masuk email kamu."}
            </p>
          )}
        </div>

        {apiError && (
          <Alert variant="destructive" className="rounded-2xl">
            <AlertDescription>{apiError}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="h-12 w-full rounded-xl text-base font-semibold" disabled={request.isPending}>
          {request.isPending ? <Loader2Icon className="animate-spin" /> : null}
          {request.isPending ? "Mengirim kode…" : "Kirim kode OTP"}
        </Button>
      </form>

      {demo && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            atau
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full rounded-xl text-base font-semibold"
            disabled={demoLogin.isPending}
            onClick={() => demoLogin.mutate(role)}
          >
            {demoLogin.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Masuk dengan akun demo {role === "MERCHANT" ? "warung" : "pembeli"}
          </Button>
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Langsung masuk tanpa kode. Isinya data contoh, bukan pesanan sungguhan.
          </p>
        </div>
      )}
    </div>
  );
}
