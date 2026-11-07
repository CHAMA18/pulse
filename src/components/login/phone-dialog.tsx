"use client";

import { ArrowLeft, Loader2, MessageSquareText, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const COUNTRIES = [
  { code: "+254", label: "Kenya" },
  { code: "+256", label: "Uganda" },
  { code: "+255", label: "Tanzania" },
  { code: "+260", label: "Zambia" },
  { code: "+251", label: "Ethiopia" },
  { code: "+234", label: "Nigeria" },
  { code: "+91", label: "India" },
  { code: "+971", label: "UAE" },
] as const;

type Step = "phone" | "otp";

export function PhoneDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("phone");
  const [country, setCountry] = useState<string>(COUNTRIES[0].code);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const reset = () => {
    setStep("phone");
    setPhone("");
    setCode("");
    setError(null);
    setCooldown(0);
  };

  const digits = useMemo(() => phone.replace(/\D/g, ""), [phone]);
  const phoneValid = digits.length >= 7 && digits.length <= 12;
  const e164 = `${country}${digits}`;

  const send = async () => {
    if (sending) return;
    if (!phoneValid) {
      setError("Enter a valid phone number (7–12 digits).");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: e164 }),
      });
      const data = (await res.json()) as { ok: boolean; devCode?: string; message?: string };
      if (res.ok && data.ok) {
        setStep("otp");
        setCode("");
        setCooldown(30);
        toast({
          title: "Verification code sent",
          description: data.devCode
            ? `Demo mode — your code is ${data.devCode}.`
            : "Check your messages.",
        });
      } else {
        setError(data.message ?? "Couldn't send the code. Please try again.");
      }
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const verify = async (value: string) => {
    if (verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: e164, code: value }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      if (res.ok && data.ok) {
        onOpenChange(false);
        reset();
        toast({
          title: "Phone verified ✨",
          description: "Signing you in to Pulse…",
        });
      } else {
        setCode("");
        setError(data.message ?? "That code isn't right. Please try again.");
      }
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const onOtpChange = (value: string) => {
    setCode(value);
    setError(null);
    if (value.length === 6) void verify(value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="pulse-scroll sm:max-w-[400px]">
        {step === "phone" ? (
          <>
            <DialogHeader>
              <span className="mx-auto mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-lg shadow-purple-500/40">
                <Smartphone className="h-5 w-5" aria-hidden="true" />
              </span>
              <DialogTitle className="text-center text-xl">Sign in with phone</DialogTitle>
              <DialogDescription className="text-center">
                We&rsquo;ll text you a one-time verification code.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3.5">
              <div className="flex gap-2.5">
                <span className="sr-only" id="country-label">
                  Country code
                </span>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger
                    aria-labelledby="country-label"
                    className="h-12 w-[132px] shrink-0 rounded-xl border-slate-200 focus-visible:border-fuchsia-400 focus-visible:ring-fuchsia-500/15 data-[state=open]:border-fuchsia-400"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} <span className="text-slate-400">{c.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex-1">
                  <label htmlFor="phone-number" className="sr-only">
                    Phone number
                  </label>
                  <input
                    id="phone-number"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                    aria-invalid={!!error}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-500/15 aria-[invalid=true]:border-rose-300"
                  />
                </div>
              </div>
              {error && (
                <p role="alert" className="text-xs text-rose-600">
                  {error}
                </p>
              )}
              <Button
                type="button"
                onClick={send}
                disabled={sending}
                className="btn-brand h-12 w-full rounded-xl border-0 text-[15px] font-semibold text-white shadow-[0_14px_34px_-10px_rgba(168,85,247,0.65)] hover:shadow-[0_18px_44px_-10px_rgba(168,85,247,0.8)]"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" /> Sending…
                  </>
                ) : (
                  <>
                    <MessageSquareText className="h-[18px] w-[18px]" aria-hidden="true" /> Send code
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <button
                type="button"
                onClick={() => setStep("phone")}
                className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-fuchsia-500"
                aria-label="Use a different number"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="mx-auto mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-lg shadow-purple-500/40">
                <MessageSquareText className="h-5 w-5" aria-hidden="true" />
              </span>
              <DialogTitle className="text-center text-xl">Enter the code</DialogTitle>
              <DialogDescription className="text-center">
                Sent to <span className="font-medium text-slate-700">{e164}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={onOtpChange}
                disabled={verifying}
                aria-label="6-digit verification code"
              >
                <InputOTPGroup className="gap-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="h-12 w-10 rounded-xl border-slate-200 text-[17px] font-semibold text-slate-900 shadow-sm transition focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-500/20 data-[filled=true]:border-fuchsia-300"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error && (
                <p role="alert" className="text-xs text-rose-600">
                  {error}
                </p>
              )}
              <Button
                type="button"
                onClick={() => void verify(code)}
                disabled={code.length !== 6 || verifying}
                className="btn-brand h-11 w-full rounded-xl border-0 text-[15px] font-semibold text-white shadow-[0_14px_34px_-10px_rgba(168,85,247,0.65)]"
              >
                {verifying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Verifying…
                  </>
                ) : (
                  "Verify & sign in"
                )}
              </Button>
              <button
                type="button"
                onClick={send}
                disabled={cooldown > 0 || sending}
                className="rounded-md text-[13px] text-slate-500 transition-colors hover:text-fuchsia-600 hover:underline disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
              <p className="rounded-lg bg-fuchsia-50 px-3 py-1.5 text-center text-[11px] text-fuchsia-700">
                Demo mode — the code is <span className="font-semibold">123456</span>
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
