"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PulseMark } from "@/components/login/pulse-logo";
import { getFirebaseAuth, resolvePortalAccess } from "@/lib/firebase";
import {
  clearStoredPortal,
  routeForPortal,
  setStoredPortal,
  type Portal,
} from "@/lib/portal";
import { portalDisplayName } from "@/lib/portal-access";

type GuardState = "checking" | "authed" | "denied" | "error";

export function AuthGuard({
  portal,
  children,
}: {
  portal: Portal;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<GuardState>("checking");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    const signOutAnd = async (notice: string) => {
      const auth = getFirebaseAuth();
      if (auth) {
        try {
          await signOut(auth);
        } catch {
          /* Clear the local portal preference even if remote sign-out fails. */
        }
      }
      clearStoredPortal();
      if (!active) return;
      setMessage(notice);
      setState("denied");
    };

    void (async () => {
      const auth = getFirebaseAuth();
      if (!auth) {
        if (active) router.replace("/login");
        return;
      }
      try {
        await auth.authStateReady();
      } catch {
        /* Resolve the best current session if persistence lookup failed. */
      }
      if (!active) return;

      const current = auth.currentUser;
      if (!current) {
        router.replace("/login");
        return;
      }

      const access = await resolvePortalAccess(current);
      if (!active) return;
      if (access.status === "allowed") {
        if (access.portal !== portal) {
          setStoredPortal(access.portal);
          router.replace(routeForPortal(access.portal));
          return;
        }
        setState("authed");
        return;
      }
      if (access.status === "revoked") {
        await signOutAnd(
          "Access to this account was removed. Ask an administrator if you think this is a mistake."
        );
        return;
      }
      if (access.status === "unassigned") {
        await signOutAnd(
          `${current.email ?? "This account"} isn't assigned to the ${portalDisplayName(
            portal
          )}. Ask an administrator to set its account type.`
        );
        return;
      }

      setMessage(
        "We couldn't verify which portal this account belongs to. Check your connection and try again."
      );
      setState("error");
    })();

    return () => {
      active = false;
    };
  }, [portal, router, attempt]);

  const onSignOut = async () => {
    const auth = getFirebaseAuth();
    if (auth) {
      try {
        await signOut(auth);
      } catch {
        /* Local sign-out and navigation still clear access on this device. */
      }
    }
    clearStoredPortal();
    router.replace("/login");
  };

  if (state === "denied" || state === "error") {
    return (
      <div className="pulse-space flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl bg-white px-6 py-8 text-center shadow-2xl dark:bg-[#140a26]">
          <PulseMark className="mx-auto h-12 w-12" glow={false} />
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            {state === "denied" ? "Portal access unavailable" : "Couldn't verify your account"}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-slate-500 dark:text-slate-400">
            {message}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            {state === "error" && (
              <button
                type="button"
                onClick={() => {
                  setState("checking");
                  setAttempt((value) => value + 1);
                }}
                className="btn-brand inline-flex h-11 items-center justify-center rounded-md text-sm font-semibold text-white"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex h-11 items-center justify-center rounded-md border border-slate-200 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state !== "authed") {
    return (
      <div
        className="pulse-space flex min-h-dvh flex-col items-center justify-center gap-5"
        aria-live="polite"
        aria-busy="true"
      >
        <PulseMark className="h-14 w-14 animate-float" />
        <p className="flex items-center gap-2.5 text-sm text-white/70">
          <span className="h-2 w-2 animate-pulse rounded-full bg-fuchsia-400" aria-hidden="true" />
          Preparing your workspace…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
