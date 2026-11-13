"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PulseMark } from "@/components/login/pulse-logo";
import { getFirebaseAuth } from "@/lib/firebase";

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
      if (auth.currentUser) {
        setState("authed");
      } else {
        setState("anonymous");
        router.replace("/login");
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

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
