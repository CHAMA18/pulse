"use client";

import { Loader2, KeyRound } from "lucide-react";
import { sendPasswordResetEmail } from "firebase/auth";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  authErrorCode,
  describeAuthError,
  getFirebaseAuth,
  trackEvent,
} from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    const auth = getFirebaseAuth();
    if (!auth) {
      setError("Authentication isn't available right now. Please refresh and try again.");
      return;
    }
    setError(null);
    setSending(true);
    void trackEvent("password_reset_request");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      onOpenChange(false);
      void trackEvent("password_reset_sent");
      toast({
        title: "Reset link sent",
        description: `If an account exists for ${email.trim()}, a reset link is on its way. Check your inbox (and spam).`,
      });
      setEmail("");
    } catch (err) {
      void trackEvent("password_reset_failure", { reason: authErrorCode(err) });
      setError(
        authErrorCode(err) === "auth/user-not-found"
          ? "We couldn't find an account with that email."
          : describeAuthError(err)
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <span className="mx-auto mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-lg shadow-purple-500/40">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <DialogTitle className="text-center text-xl">Reset your password</DialogTitle>
          <DialogDescription className="text-center">
            Enter the email linked to your Pulse account and we&rsquo;ll send you a reset link.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="forgot-email" className="sr-only">
              Email address
            </label>
            <Input
              id="forgot-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              aria-invalid={!!error}
              aria-describedby={error ? "forgot-error" : undefined}
              className={
                error
                  ? "border-rose-300 focus-visible:ring-rose-500/20"
                  : "focus-visible:ring-fuchsia-500/20 focus-visible:border-fuchsia-400"
              }
            />
            {error && (
              <p id="forgot-error" role="alert" className="mt-1.5 text-xs text-rose-600">
                {error}
              </p>
            )}
          </div>
          <Button
            type="submit"
            disabled={sending}
            className="btn-brand h-11 w-full border-0 text-[15px] font-semibold text-white shadow-[0_12px_28px_-10px_rgba(168,85,247,0.65)] hover:shadow-[0_16px_36px_-10px_rgba(168,85,247,0.8)]"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sending…
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
