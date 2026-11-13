"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PulseMark } from "@/components/login/pulse-logo";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";

type GuardState = "checking" | "authed" | "anonymous";

/**
 * Client-side route guard for authenticated screens.
 *
 * Waits for Firebase to resolve the persisted session (authStateReady),
 * then either renders the children or bounces the visitor back to the
 * login screen. While checking, a branded splash avoids any flash.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuardState>("checking");

  useEffect(() => {
    let active = true;

    void (async () => {
      const auth = getFirebaseAuth();
      // Fail closed: without a Firebase session there is nothing to render
      // behind this guard — send the visitor to sign in instead of through.
      if (!auth) {
        if (active) {
          setState("anonymous");
          router.replace("/login");
        }
        return;
      }
      try {
        await auth.authStateReady();
      } catch {
        /* resolution failed — fall through to the currentUser check */
      }
      if (!active) return;
      if (!auth.currentUser) {
        setState("anonymous");
        router.replace("/login");
        return;
      }

      // A signed-in account still belongs to exactly one portal. A pharmacy
      // login must never see the Pulse console, and vice versa — send it to
      // the portal its profile names.
      try {
        const db = getFirebaseDb();
        if (db) {
          const { doc, getDoc } = await import("firebase/firestore");
          const snap = await getDoc(doc(db, "User", auth.currentUser.uid));
          const accountType = String(snap.data()?.account_type ?? "");
          const onPulse = pathname.startsWith("/dashboard");
          if (accountType === "Pharmacy" && onPulse) {
            router.replace("/pharmacy");
            return;
          }
          if (accountType === "Pulse" && pathname.startsWith("/pharmacy")) {
            router.replace("/dashboard");
            return;
          }
        }
      } catch {
        /* rules or offline — the page's own access checks still apply */
      }
      if (active) setState("authed");
    })();

    return () => {
      active = false;
    };
  }, [router, pathname]);

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
          {state === "checking" ? "Preparing your workspace…" : "Taking you back to sign in…"}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
