"use client";

import { useEffect } from "react";
import { PulseMark } from "@/components/login/pulse-logo";

export default function OfflinePage() {
  useEffect(() => {
    const retry = () => window.location.reload();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  return (
    <main className="pulse-space flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <PulseMark className="h-14 w-14 animate-float" />
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-white">
          You&rsquo;re offline
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-white/70">
          Pulse couldn&rsquo;t reach the network. Your pharmacy records stay on this
          device, and anything you change syncs automatically once you reconnect.
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex h-10 items-center justify-center rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-5 text-[13.5px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(147,51,234,0.65)] transition-shadow hover:shadow-[0_12px_28px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
      >
        Try again
      </button>
    </main>
  );
}
