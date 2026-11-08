"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MailPlus,
  Store,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmailPreviewDialog } from "@/components/cloud/email-preview-dialog";
import {
  callCloudFunction,
  type InvitationMessage,
} from "@/lib/cloud/invitations";
import { setStoredPortal } from "@/lib/portal";
import {
  authErrorCode,
  describeAuthError,
  registerPharmacyAccount,
  trackEvent,
} from "@/lib/firebase";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "loading" | "success";
type Errors = {
  pharmacyName?: string;
  ownerName?: string;
  email?: string;
  password?: string;
  confirm?: string;
};

const TEAM_EMAIL_LIMIT = 8;

/**
 * "Register your pharmacy" — the self-serve onboarding dialog shown from the
 * Pharmacy portal. Creates a real Firebase Auth account plus the `User/{uid}`
 * profile the Pulse pharmacy app reads, then hands the fresh session to the
 * console.
 */
export function RegisterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const [pharmacyName, setPharmacyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [registeredName, setRegisteredName] = useState<string | null>(null);

  // Team invitations — addresses listed here receive a branded Pulse
  // invitation the moment the pharmacy is created.
  const [teamEmails, setTeamEmails] = useState<string[]>([]);
  const [teamInput, setTeamInput] = useState("");
  const [teamError, setTeamError] = useState<string | null>(null);
  const [inviteMessages, setInviteMessages] = useState<InvitationMessage[]>([]);
  const [invitesPending, setInvitesPending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const addTeamEmail = (raw: string) => {
    // Paste-friendly: "a@x.co, b@y.co; c@z.co" lands as three chips in one go.
    const candidates = raw
      .split(/[,;\s]+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    if (candidates.length === 0) return;

    const next = [...teamEmails];
    for (const value of candidates) {
      if (!EMAIL_RE.test(value)) {
        setTeamError("That email doesn't look right.");
        return;
      }
      if (next.includes(value)) {
        setTeamError("That address is already on the list.");
        return;
      }
      if (next.length >= TEAM_EMAIL_LIMIT) {
        setTeamError(`Up to ${TEAM_EMAIL_LIMIT} invitations at registration — add more later in User Management.`);
        return;
      }
      next.push(value);
    }
    setTeamError(null);
    setTeamEmails(next);
    setTeamInput("");
  };

  const removeTeamEmail = (value: string) => {
    setTeamEmails((prev) => prev.filter((entry) => entry !== value));
    setTeamError(null);
  };

  const pharmacyRef = useRef<HTMLInputElement>(null);

  // Reopening the dialog starts a fresh form. Reset during render when the
  // `open` prop flips (the React-documented alternative to a reset effect,
  // which the react-hooks/set-state-in-effect rule forbids).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPharmacyName("");
      setOwnerName("");
      setEmail("");
      setPassword("");
      setConfirm("");
      setShowPassword(false);
      setErrors({});
      setFormError(null);
      setStatus("idle");
      setRegisteredName(null);
      setTeamEmails([]);
      setTeamInput("");
      setTeamError(null);
      setInviteMessages([]);
      setInvitesPending(false);
      setPreviewOpen(false);
    }
  }

  // While the success view is wrapping up (invitations in flight, or the
  // email preview open) the dialog must not close — a stray click on the
  // overlay would otherwise strand the visitor mid-registration.
  useEffect(() => {
    if (!open || status !== "success" || invitesPending || previewOpen) return;
    const timer = window.setTimeout(() => {
      onOpenChange(false);
      // New pharmacies open their own portal console, not the Pulse admin one.
      setStoredPortal("pharmacy");
      router.push("/pharmacy");
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [open, status, invitesPending, previewOpen, onOpenChange, router]);

  const validate = (): Errors => {
    const next: Errors = {};
    if (pharmacyName.trim().length < 2)
      next.pharmacyName = "Enter your pharmacy's name.";
    if (!ownerName.trim()) next.ownerName = "Enter the owner's full name.";
    if (!email.trim()) next.email = "Enter your email address.";
    else if (!EMAIL_RE.test(email.trim()))
      next.email = "That email doesn't look right.";
    if (!password) next.password = "Choose a password.";
    else if (password.length < 8)
      next.password = "Use at least 8 characters.";
    if (!confirm) next.confirm = "Re-enter your password.";
    else if (confirm !== password) next.confirm = "Passwords don't match.";
    return next;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status !== "idle") return;

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.pharmacyName) pharmacyRef.current?.focus();
      return;
    }

    setFormError(null);
    setStatus("loading");
    try {
      const result = await registerPharmacyAccount({
        pharmacyName,
        ownerName,
        email: email.trim(),
        password,
      });
      setRegisteredName(result.pharmacyName);
      setStatus("success");
      void trackEvent("pharmacy_registered", {
        portal: "pharmacy",
        profile_saved: result.profileSaved,
        invites: teamEmails.length,
      });

      // Trigger onPharmacyCreated — the owner's welcome email (always) plus
      // one branded team invitation per address listed above, straight from
      // the cloud function.
      setInvitesPending(true);
      try {
        const cloud = await callCloudFunction("onPharmacyCreated", {
          pharmacyName: result.pharmacyName,
          ownerName: result.ownerName,
          ownerEmail: result.email,
          teamEmails,
        });
        setInviteMessages(cloud.messages);
      } catch {
        /* invitations are retried from User Management — never block entry */
      } finally {
        setInvitesPending(false);
      }
    } catch (err) {
      setStatus("idle");
      const code = authErrorCode(err);
      void trackEvent("pharmacy_registered", { portal: "pharmacy", reason: code });
      setFormError(
        code === "auth/email-already-in-use"
          ? "An account with this email already exists — sign in instead."
          : describeAuthError(err)
      );
    }
  };

  const inputBase =
    "h-12 w-full rounded-md border bg-white px-4 text-[15px] text-slate-900 outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400";

  const inputState = (hasError?: string) =>
    hasError
      ? "border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-500/10"
      : "border-slate-200 hover:border-slate-300 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-500/15";

  const fieldError = (message?: string, id?: string) =>
    message && (
      <p id={id} role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
        <AlertCircle className="h-3.5 w-3.5" /> {message}
      </p>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (status === "success") return; // hand-off in progress
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto rounded-2xl bg-[linear-gradient(180deg,#ffffff_0%,#fbf9fe_100%)] p-6 sm:max-w-[440px] sm:p-8"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          pharmacyRef.current?.focus();
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {status === "success" ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex flex-col items-center py-8 text-center"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
                <CheckCircle2 className="h-9 w-9 text-emerald-500" aria-hidden="true" />
              </span>
              <DialogHeader className="mt-5 space-y-2">
                <DialogTitle className="text-[22px] font-semibold tracking-tight text-slate-900">
                  Pharmacy registered! 🎉
                </DialogTitle>
                <DialogDescription className="text-[14px] leading-relaxed text-slate-500">
                  <span className="font-medium text-slate-700">{registeredName}</span> now has a
                  Pulse account. Taking you to your pharmacy console…
                </DialogDescription>
              </DialogHeader>

              {/* Invitations fired by the onPharmacyCreated cloud function */}
              {invitesPending ? (
                <p className="mt-4 flex items-center gap-2 text-[13px] font-medium text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-purple-500" aria-hidden="true" />
                  Sending invitations via Pulse Cloud…
                </p>
              ) : inviteMessages.length > 0 ? (
                <div className="mt-4 w-full max-w-[340px] rounded-xl border border-purple-100 bg-purple-50/60 px-4 py-3.5 text-left dark:border-purple-500/20 dark:bg-purple-500/10">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-purple-700 dark:text-purple-300">
                    <MailPlus className="h-4 w-4" aria-hidden="true" />
                    {inviteMessages.length} email{inviteMessages.length === 1 ? "" : "s"} sent —
                    welcome + {Math.max(0, inviteMessages.length - 1)} invitation
                    {inviteMessages.length - 1 === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {inviteMessages.map((msg) => (
                      <li key={msg.id} className="flex items-center gap-1.5 text-[12.5px] text-slate-600 dark:text-slate-300">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                        <span className="min-w-0 truncate">{msg.to.join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="mt-2.5 text-[12.5px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
                  >
                    Preview the emails
                  </button>
                </div>
              ) : null}

              <span className="mt-4 flex items-center gap-2 text-[12px] text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Signing you in
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <DialogHeader className="space-y-1.5 text-center sm:text-center">
                <DialogTitle className="text-[24px] font-semibold tracking-tight text-slate-900">
                  Register your pharmacy
                </DialogTitle>
                <DialogDescription className="text-[13.5px] text-slate-500">
                  Join the Pulse network — stock, staff and sales in one console.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
                {/* Pharmacy name */}
                <div className="relative">
                  <label htmlFor="register-pharmacy" className="sr-only">
                    Pharmacy name
                  </label>
                  <Store
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
                  />
                  <input
                    ref={pharmacyRef}
                    id="register-pharmacy"
                    name="pharmacyName"
                    type="text"
                    autoComplete="organization"
                    placeholder="Pharmacy name"
                    value={pharmacyName}
                    onChange={(e) => {
                      setPharmacyName(e.target.value);
                      if (errors.pharmacyName) setErrors((p) => ({ ...p, pharmacyName: undefined }));
                      if (formError) setFormError(null);
                    }}
                    aria-invalid={!!errors.pharmacyName}
                    aria-describedby={errors.pharmacyName ? "pharmacy-error" : undefined}
                    className={cn(inputBase, inputState(errors.pharmacyName), "pl-11")}
                  />
                  {fieldError(errors.pharmacyName, "pharmacy-error")}
                </div>

                {/* Owner name */}
                <div className="relative">
                  <label htmlFor="register-owner" className="sr-only">
                    Owner full name
                  </label>
                  <UserRound
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="register-owner"
                    name="ownerName"
                    type="text"
                    autoComplete="name"
                    placeholder="Owner full name"
                    value={ownerName}
                    onChange={(e) => {
                      setOwnerName(e.target.value);
                      if (errors.ownerName) setErrors((p) => ({ ...p, ownerName: undefined }));
                      if (formError) setFormError(null);
                    }}
                    aria-invalid={!!errors.ownerName}
                    className={cn(inputBase, inputState(errors.ownerName), "pl-11")}
                  />
                  {fieldError(errors.ownerName)}
                </div>

                {/* Email */}
                <div className="relative">
                  <label htmlFor="register-email" className="sr-only">
                    Email address
                  </label>
                  <Mail
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="register-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                      if (formError) setFormError(null);
                    }}
                    aria-invalid={!!errors.email}
                    className={cn(inputBase, inputState(errors.email), "pl-11")}
                  />
                  {fieldError(errors.email)}
                </div>

                {/* Password */}
                <div className="relative">
                  <label htmlFor="register-password" className="sr-only">
                    Password
                  </label>
                  <Lock
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="register-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Password (min. 8 characters)"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                      if (formError) setFormError(null);
                    }}
                    aria-invalid={!!errors.password}
                    className={cn(inputBase, inputState(errors.password), "pl-11 pr-12")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500"
                  >
                    {showPassword ? (
                      <EyeOff className="h-[18px] w-[18px]" />
                    ) : (
                      <Eye className="h-[18px] w-[18px]" />
                    )}
                  </button>
                  {fieldError(errors.password)}
                </div>

                {/* Confirm password */}
                <div className="relative">
                  <label htmlFor="register-confirm" className="sr-only">
                    Confirm password
                  </label>
                  <Lock
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="register-confirm"
                    name="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Confirm password"
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      if (errors.confirm) setErrors((p) => ({ ...p, confirm: undefined }));
                      if (formError) setFormError(null);
                    }}
                    aria-invalid={!!errors.confirm}
                    className={cn(inputBase, inputState(errors.confirm), "pl-11")}
                  />
                  {fieldError(errors.confirm)}
                </div>

                {/* Submit error */}
                {formError && (
                  <div
                    role="alert"
                    className="animate-shake flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] leading-snug text-rose-700"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Invite your team — emails outlined here receive the
                    branded Pulse invitation the moment this pharmacy is
                    created (triggered by the onPharmacyCreated function). */}
                <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-4 dark:border-purple-500/20 dark:bg-purple-500/10">
                  <label
                    htmlFor="register-team"
                    className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700 dark:text-slate-200"
                  >
                    <MailPlus className="h-4 w-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
                    Invite your team
                    <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Each address below receives a branded Pulse invitation the moment your pharmacy
                    is created.
                  </p>
                  <input
                    id="register-team"
                    type="email"
                    inputMode="email"
                    value={teamInput}
                    onChange={(e) => {
                      setTeamInput(e.target.value);
                      setTeamError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addTeamEmail(teamInput);
                      }
                    }}
                    onBlur={() => {
                      if (teamInput.trim()) addTeamEmail(teamInput);
                    }}
                    placeholder="Type an email and press Enter"
                    autoComplete="off"
                    className="mt-2.5 h-11 w-full rounded-md border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                  {teamError && (
                    <p role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
                      <AlertCircle className="h-3.5 w-3.5" /> {teamError}
                    </p>
                  )}
                  {teamEmails.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {teamEmails.map((value) => (
                        <span
                          key={value}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white py-1 pl-3 pr-1.5 text-[12.5px] font-semibold text-slate-700 ring-1 ring-purple-200 dark:bg-white/10 dark:text-slate-200 dark:ring-purple-500/30"
                        >
                          <span className="min-w-0 truncate">{value}</span>
                          <button
                            type="button"
                            onClick={() => removeTeamEmail(value)}
                            aria-label={`Remove ${value} from invitations`}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <motion.button
                  whileTap={{ scale: 0.985 }}
                  type="submit"
                  disabled={status === "loading"}
                  className="btn-brand relative mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-[15px] font-semibold text-white shadow-[0_14px_34px_-10px_rgba(168,85,247,0.65)] hover:shadow-[0_18px_44px_-10px_rgba(168,85,247,0.8)] disabled:cursor-not-allowed"
                >
                  {status === "loading" ? (
                    <>
                      <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
                      Creating account…
                    </>
                  ) : (
                    "Create pharmacy account"
                  )}
                </motion.button>

                <p className="text-center text-[12px] leading-relaxed text-slate-400">
                  Your pharmacy joins the Pulse network pending review. By registering you agree to
                  the Pulse terms of service.
                </p>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>

      {/* The welcome + team invitation emails, rendered like an inbox */}
      <EmailPreviewDialog
        message={previewOpen && inviteMessages[0] ? inviteMessages[0] : null}
        onOpenChange={setPreviewOpen}
        headline="Emails sent for your new pharmacy"
      />
    </Dialog>
  );
}
