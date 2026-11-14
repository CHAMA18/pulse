"use client";

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CloudFunctionError } from "@/lib/cloud/invitations";
import {
  claimPharmacyOtp,
  resolvePharmacyOtp,
  type ClaimedPharmacy,
  type PharmacyOtpPreview,
} from "@/lib/cloud/pharmacy-provisioning";
import {
  authErrorCode,
  describeAuthError,
  getFirebaseAuth,
  trackEvent,
} from "@/lib/firebase";
import { routeForPortal, setStoredPortal } from "@/lib/portal";
import { cn } from "@/lib/utils";

const inputCls =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-slate-300 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20";

function friendlyError(error: unknown): string {
  if (error instanceof CloudFunctionError && error.message) return error.message;
  const code = authErrorCode(error);
  if (code === "auth/email-already-in-use") {
    return "This owner email already has a Pulse sign-in. Use the existing account, or ask Pulse to create the profile with a different owner email.";
  }
  if (code === "auth/weak-password") return "Use at least 8 characters for the password.";
  if (code === "auth/invalid-email") return "The owner email on this profile isn't valid. Ask Pulse to correct it.";
  return describeAuthError(error);
}

export function OtpClaimDialog({
  open,
  onOpenChange,
  initialCode = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCode?: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [preview, setPreview] = useState<PharmacyOtpPreview | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
  const [claimed, setClaimed] = useState<ClaimedPharmacy | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setCode(initialCode);
      setPreview(null);
      setPassword("");
      setConfirm("");
      setShowPassword(false);
      setError(null);
      setBusy(false);
      setAccountCreated(false);
      setClaimed(null);
    }
  }

  useEffect(() => {
    if (!open || !claimed) return;
    const timer = window.setTimeout(() => {
      onOpenChange(false);
      router.push(routeForPortal("pharmacy"));
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [open, claimed, onOpenChange, router]);

  const checkCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const value = code.trim();
    if (value.replace(/[^A-Za-z0-9]/g, "").length < 10) {
      setError("Enter the full one-time password from Pulse.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const found = await resolvePharmacyOtp(value);
      setPreview(found);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !preview) return;

    if (!accountCreated) {
      if (password.length < 8) {
        setError("Choose a password with at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("The passwords don't match.");
        return;
      }
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setError("Authentication isn't available right now. Refresh the page and try again.");
      return;
    }

    setBusy(true);
    setError(null);
    let createdNow = false;
    try {
      if (!accountCreated) {
        if (auth.currentUser) {
          await signOut(auth);
        }
        try {
          const credential = await createUserWithEmailAndPassword(
            auth,
            preview.ownerEmail,
            password
          );
          try {
            await updateProfile(credential.user, { displayName: preview.ownerName });
          } catch {
            /* the server writes the display name from the provisioning record */
          }
          createdNow = true;
        } catch (err) {
          // A previous attempt may have created the sign-in before the claim
          // failed. If the password matches, claim with that account.
          if (authErrorCode(err) !== "auth/email-already-in-use") throw err;
          await signInWithEmailAndPassword(auth, preview.ownerEmail, password);
        }
        setAccountCreated(true);
      }


      const result = await claimPharmacyOtp(code.trim());
      setClaimed(result);
      setStoredPortal("pharmacy");
      void trackEvent("pharmacy_otp_claimed", {
        pharmacy: result.pharmacyName,
        createdAccount: createdNow,
      });
    } catch (err) {
      setError(
        createdNow
          ? `${friendlyError(err)} Your sign-in was created — keep this OTP and click “Retry activation”.`
          : friendlyError(err)
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[490px]">
        {claimed ? (
          <>
            <DialogHeader>
              <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </span>
              <DialogTitle>Pharmacy activated</DialogTitle>
              <DialogDescription>
                {claimed.pharmacyName} is live. Taking you to the pharmacy console…
              </DialogDescription>
            </DialogHeader>
            <div className="mt-1 flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-[13px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Signed in as {claimed.email}
            </div>
          </>
        ) : preview ? (
          <>
            <DialogHeader>
              <button
                type="button"
                onClick={() => {
                  if (accountCreated) return;
                  setPreview(null);
                  setError(null);
                }}
                disabled={accountCreated}
                className="mb-1 inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-slate-500 transition-colors hover:text-fuchsia-600 disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back to OTP
              </button>
              <DialogTitle>Validate this pharmacy</DialogTitle>
              <DialogDescription>
                The OTP matched a profile Pulse created. Set the owner password to
                activate it — no other details are needed.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-1 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-white/10 dark:bg-white/5">
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300">
                  <Store className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold text-slate-900 dark:text-white">
                    {preview.pharmacyName}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-slate-500 dark:text-slate-400">
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                    {preview.ownerName}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-slate-500 dark:text-slate-400">
                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    {preview.ownerEmail}
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={activate} className="mt-3 space-y-3.5">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                  <Lock className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden="true" />
                  {accountCreated ? "Password already set" : "Create a password"}
                </span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (error) setError(null);
                    }}
                    disabled={accountCreated}
                    placeholder="At least 8 characters"
                    className={cn(inputCls, "pr-11 disabled:opacity-60")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    disabled={accountCreated}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 disabled:opacity-40 dark:hover:bg-white/10"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              {!accountCreated && (
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                    <Lock className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden="true" />
                    Confirm password
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => {
                      setConfirm(event.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Re-enter the password"
                    className={inputCls}
                  />
                </label>
              )}

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 text-[14px] font-semibold text-white shadow-[0_12px_28px_-12px_rgba(168,85,247,0.8)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {busy
                  ? "Activating…"
                  : accountCreated
                    ? "Retry activation"
                    : "Activate pharmacy account"}
              </button>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-300">
                <KeyRound className="h-6 w-6" aria-hidden="true" />
              </span>
              <DialogTitle>Have a pharmacy OTP?</DialogTitle>
              <DialogDescription>
                Pulse created your pharmacy profile. Enter the one-time password
                from your Pulse contact to validate it and set your password.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={checkCode} className="mt-1 space-y-3.5">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                  <KeyRound className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden="true" />
                  One-time password
                </span>
                <input
                  autoFocus
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.toUpperCase());
                    if (error) setError(null);
                  }}
                  placeholder="PULSE-XXXXX-XXXXX"
                  className={cn(
                    inputCls,
                    "font-mono text-[16px] font-semibold tracking-[0.12em]"
                  )}
                />
              </label>

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 text-[14px] font-semibold text-white shadow-[0_12px_28px_-12px_rgba(168,85,247,0.8)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                )}
                {busy ? "Checking…" : "Validate OTP"}
              </button>
            </form>

            <p className="mt-1 text-center text-[11.5px] leading-relaxed text-slate-400">
              OTPs expire after 72 hours. Ask your Pulse contact to reissue one if
              yours has expired.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
