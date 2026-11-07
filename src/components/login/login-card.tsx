"use client";

import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Pill,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ForgotDialog } from "@/components/login/forgot-dialog";
import { GoogleIcon } from "@/components/login/google-icon";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  authErrorCode,
  describeAuthError,
  getFirebaseAuth,
  googleProvider,
  isAdminUser,
  trackEvent,
} from "@/lib/firebase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.065, delayChildren: 0.12 } },
};

const item = {
  hidden: { opacity: 0, y: 16, filter: "blur(5px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  },
};

type Status = "idle" | "loading" | "success";
type Portal = "pulse" | "pharmacy";

const PORTALS: { id: Portal; label: string; icon: LucideIcon }[] = [
  { id: "pulse", label: "Pulse", icon: UserRound },
  { id: "pharmacy", label: "Pharmacy", icon: Pill },
];

/**
 * Segmented control for choosing the authentication portal.
 * The active thumb slides between segments (shared layout animation).
 */
function PortalToggle({
  value,
  onChange,
  disabled,
}: {
  value: Portal;
  onChange: (portal: Portal) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Authentication portal"
      className="relative grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100/80 p-1"
    >
      {PORTALS.map(({ id, label, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={cn(
              "relative flex h-10 items-center justify-center gap-1.5 rounded-[4px] text-[13.5px] font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-60",
              active ? "text-white" : "text-slate-500 hover:text-slate-700"
            )}
          >
            {active && (
              <motion.span
                layoutId="portal-thumb"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="btn-brand absolute inset-0 rounded-[4px] shadow-[0_4px_12px_-4px_rgba(168,85,247,0.7)]"
                aria-hidden="true"
              />
            )}
            <Icon className="relative z-10 h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            <span className="relative z-10">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function LoginCard() {
  const { toast } = useToast();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [capsLock, setCapsLock] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [portal, setPortal] = useState<Portal>("pulse");
  const [googleLoading, setGoogleLoading] = useState(false);

  const [forgotOpen, setForgotOpen] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  /** Pointer-tracked spotlight — writes CSS vars, zero re-renders. */
  const onCardMove = (e: React.MouseEvent<HTMLElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const validate = useCallback(
    (field: "email" | "password") => {
      setErrors((prev) => {
        const next = { ...prev };
        if (field === "email") {
          if (!email.trim()) next.email = "Enter your email address.";
          else if (!EMAIL_RE.test(email.trim())) next.email = "That email doesn't look right.";
          else delete next.email;
        } else {
          if (!password) next.password = "Enter your password.";
          else delete next.password;
        }
        return next;
      });
    },
    [email, password]
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading" || status === "success") return;

    const emailOk = EMAIL_RE.test(email.trim());
    const nextErrors: typeof errors = {};
    if (!email.trim()) nextErrors.email = "Enter your email address.";
    else if (!emailOk) nextErrors.email = "That email doesn't look right.";
    if (!password) nextErrors.password = "Enter your password.";
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.email) emailRef.current?.focus();
      else passwordRef.current?.focus();
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setFormError("Authentication isn't available right now. Please refresh and try again.");
      return;
    }

    setFormError(null);
    setStatus("loading");
    void trackEvent("login_attempt", { method: "password", portal });
    try {
      // "Remember me" → keep the session across browser restarts (local),
      // otherwise end it when the tab closes (session).
      await setPersistence(
        auth,
        remember ? browserLocalPersistence : browserSessionPersistence
      );
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const user = credential.user;

      // Pharmacy portal: refuse sessions without elevated (admin) rights.
      if (portal === "pharmacy" && !(await isAdminUser(user))) {
        await signOut(auth);
        setStatus("idle");
        void trackEvent("login_failure", { method: "password", portal, reason: "not_pharmacy_admin" });
        setFormError("This account doesn't have Pharmacy portal access. Use the Pulse portal instead.");
        return;
      }

      setStatus("success");
      void trackEvent("login", { method: "password", status: "success", portal });
      const firstName = (user.displayName ?? user.email?.split("@")[0] ?? "there").split(" ")[0];
      toast({
        title: `Welcome back, ${firstName} 👋`,
        description:
          portal === "pharmacy"
            ? "Signing you in to the Pharmacy portal…"
            : "Signing you in to Pulse…",
      });
      // Hand the fresh session to the Pulse console.
      window.setTimeout(() => router.push("/dashboard"), 900);
    } catch (err) {
      setStatus("idle");
      void trackEvent("login_failure", { method: "password", portal, reason: authErrorCode(err) });
      setFormError(describeAuthError(err));
    }
  };

  const onGoogle = async () => {
    if (googleLoading) return;
    const auth = getFirebaseAuth();
    if (!auth) {
      toast({
        title: "Google sign-in unavailable",
        description: "Authentication isn't available right now. Please refresh and try again.",
        variant: "destructive",
      });
      return;
    }
    setGoogleLoading(true);
    void trackEvent("login_attempt", { method: "google", portal });
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Pharmacy portal: refuse sessions without elevated (admin) rights.
      if (portal === "pharmacy" && !(await isAdminUser(user))) {
        await signOut(auth);
        void trackEvent("login_failure", { method: "google", portal, reason: "not_pharmacy_admin" });
        toast({
          title: "Pharmacy access required",
          description: "This account doesn't have Pharmacy portal access. Use the Pulse portal instead.",
          variant: "destructive",
        });
        return;
      }

      void trackEvent("login", { method: "google", status: "success", portal });
      toast({
        title: "Signed in with Google",
        description: [user.displayName, user.email].filter(Boolean).join(" · ") || "Welcome to Pulse",
      });
      // Hand the fresh session to the Pulse console.
      window.setTimeout(() => router.push("/dashboard"), 900);
    } catch (err) {
      const code = authErrorCode(err);
      void trackEvent("login_failure", { method: "google", portal, reason: code });
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        toast({ title: "Google sign-in cancelled" });
      } else {
        toast({
          title: "Google sign-in failed",
          description: describeAuthError(err),
          variant: "destructive",
        });
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const inputBase =
    "h-12 w-full rounded-md border bg-white px-4 text-[15px] text-slate-900 outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400";

  const inputState = (hasError?: string) =>
    hasError
      ? "border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-500/10"
      : "border-slate-200 hover:border-slate-300 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-500/15";

  return (
    <MotionConfig reducedMotion="user">
      <motion.section
        ref={cardRef}
        onMouseMove={onCardMove}
        initial={{ opacity: 0, y: 34, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 110, damping: 17, mass: 0.9 }}
        className="card-spotlight relative w-full max-w-[440px] rounded-[20px] bg-[linear-gradient(180deg,#ffffff_0%,#fbf9fe_100%)] px-6 py-9 shadow-[0_50px_140px_-24px_rgba(139,47,232,0.65),0_16px_48px_-16px_rgba(10,4,20,0.55)] sm:px-10 sm:py-10"
        aria-labelledby="login-heading"
      >
        {/* gradient hairline border */}
        <span aria-hidden="true" className="card-hairline" />
        {/* one-time sheen sweep on mount */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[20px]">
          <span className="animate-sheen absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
        </span>

        <motion.div variants={container} initial="hidden" animate="show" className="relative flex flex-col">
          {/* Heading */}
          <motion.div variants={item} className="text-center">
            <h2
              id="login-heading"
              className="text-[26px] font-semibold tracking-tight text-slate-900 sm:text-[30px]"
            >
              {portal === "pharmacy" ? "Pharmacy Portal" : "Welcome Back"}
            </h2>
            <p className="mt-1.5 text-[13.5px] text-slate-500">
              {portal === "pharmacy"
                ? "Sign in with your pharmacy account to manage Pulse."
                : "Let\u2019s get started by filling out the form below."}
            </p>
          </motion.div>

          {/* Portal toggle */}
          <motion.div variants={item} className="mt-5">
            <PortalToggle
              value={portal}
              onChange={(next) => {
                setPortal(next);
                setFormError(null);
              }}
              disabled={status === "loading"}
            />
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={portal}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="mt-2 text-center text-[12px] text-slate-400"
              >
                {portal === "pharmacy"
                  ? "For pharmacy administrators"
                  : "For patients & care teams"}
              </motion.p>
            </AnimatePresence>
          </motion.div>

          {/* Form */}
          <motion.form variants={item} onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
            {/* Email */}
            <div className="relative">
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <Mail
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-6 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
              />
              <input
                ref={emailRef}
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                  if (formError) setFormError(null);
                }}
                onBlur={() => validate("email")}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
                className={cn(inputBase, inputState(errors.email), "pl-11")}
              />
              {errors.email && (
                <p id="email-error" role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
                  <AlertCircle className="h-3.5 w-3.5" /> {errors.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <div className="relative">
                <Lock
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
                />
                <input
                  ref={passwordRef}
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                    if (formError) setFormError(null);
                  }}
                  onBlur={() => validate("password")}
                  onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                  onClick={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    [errors.password ? "password-error" : null, capsLock ? "capslock-hint" : null]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  className={cn(inputBase, inputState(errors.password), "pl-11 pr-12")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 active:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500"
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
                  <AlertCircle className="h-3.5 w-3.5" /> {errors.password}
                </p>
              )}
              {!errors.password && capsLock && (
                <p id="capslock-hint" className="mt-1.5 flex items-center gap-1 text-xs text-amber-600">
                  <TriangleAlert className="h-3.5 w-3.5" /> Caps Lock is on.
                </p>
              )}
            </div>

            {/* Remember / Forgot */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                role="checkbox"
                aria-checked={remember}
                onClick={() => setRemember((v) => !v)}
                className="group flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500"
              >
                <span
                  className={cn(
                    "flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border-2 transition-all duration-200",
                    remember
                      ? "border-transparent bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-sm shadow-purple-500/40"
                      : "border-slate-300 bg-white group-hover:border-fuchsia-400"
                  )}
                >
                  {remember && (
                    <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" aria-hidden="true">
                      <path
                        d="M2.5 6.2 4.8 8.5 9.5 3.8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span className="text-sm text-slate-600">Remember me</span>
              </button>
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                className="rounded-md text-sm text-slate-500 transition-colors hover:text-fuchsia-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500"
              >
                Forgot Password
              </button>
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

            {/* Sign In */}
            <motion.button
              whileTap={{ scale: 0.985 }}
              type="submit"
              disabled={status !== "idle"}
              className={cn(
                "btn-brand relative mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-[15px] font-semibold text-white shadow-[0_14px_34px_-10px_rgba(168,85,247,0.65)] hover:shadow-[0_18px_44px_-10px_rgba(168,85,247,0.8)] disabled:cursor-not-allowed",
                status === "success" && "!bg-none bg-emerald-500 shadow-emerald-500/40"
              )}
            >
              {status === "loading" && (
                <>
                  <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              )}
              {status === "success" && (
                <>
                  <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" />
                  Signed in!
                </>
              )}
              {status === "idle" && "Sign In"}
            </motion.button>
          </motion.form>

          {/* Divider */}
          <motion.div variants={item} className="mt-6 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">or</span>
            <span className="h-px flex-1 bg-slate-200" />
          </motion.div>

          {/* Alt sign-in */}
          <motion.div variants={item} className="mt-5 flex flex-col gap-3">
            <motion.button
              whileTap={{ scale: 0.985 }}
              type="button"
              onClick={onGoogle}
              disabled={googleLoading}
              className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-md border border-slate-200 bg-white text-[15px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500 disabled:opacity-70"
            >
              {googleLoading ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin text-slate-500" aria-hidden="true" />
              ) : (
                <GoogleIcon className="h-5 w-5" />
              )}
              Sign in with Google
            </motion.button>
          </motion.div>

          {/* Register */}
          {portal === "pulse" && (
            <motion.p variants={item} className="mt-5 text-center text-[13.5px] text-slate-500">
              Don&rsquo;t have an account?{" "}
              <button
                type="button"
                onClick={() =>
                  toast({
                    title: "Registration is invite-only",
                    description: "Ask your facility administrator for a Pulse invitation.",
                  })
                }
                className="rounded-md font-medium text-fuchsia-600 transition-colors hover:text-fuchsia-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500"
              >
                Register
              </button>
            </motion.p>
          )}

        </motion.div>
      </motion.section>

      <ForgotDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </MotionConfig>
  );
}
