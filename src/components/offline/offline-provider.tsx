"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  flushOutbox,
  getOutboxSummary,
  OUTBOX_EVENT,
  type OutboxSummary,
} from "@/lib/offline/outbox";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Offline support                                                     */
/* ------------------------------------------------------------------ */
/* Registers the app-shell service worker, tracks connectivity and     */
/* drains the Firebase sync outbox whenever the app is online. The     */
/* banner only appears when there is something the user should know.   */

const EMPTY_SUMMARY: OutboxSummary = { total: 0, inventory: 0, sales: 0, alerts: 0 };

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

/** Assume online while server-rendering so no banner flashes in. */
function getOnlineServerSnapshot(): boolean {
  return true;
}

function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getOnlineServerSnapshot
  );
}

export function OfflineProvider() {
  const online = useOnlineStatus();
  const [summary, setSummary] = useState<OutboxSummary>(EMPTY_SUMMARY);
  const [syncing, setSyncing] = useState(false);

  const refreshSummary = useCallback(() => {
    setSummary(getOutboxSummary());
  }, []);

  const runFlush = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.onLine) return;
    setSyncing(true);
    try {
      await flushOutbox();
    } finally {
      setSyncing(false);
      refreshSummary();
    }
  }, [refreshSummary]);

  // Keep the badge in step with queue writes from this tab or another one.
  useEffect(() => {
    refreshSummary();
    window.addEventListener(OUTBOX_EVENT, refreshSummary);
    window.addEventListener("storage", refreshSummary);
    return () => {
      window.removeEventListener(OUTBOX_EVENT, refreshSummary);
      window.removeEventListener("storage", refreshSummary);
    };
  }, [refreshSummary]);

  // Register the offline app shell in production builds only — a dev-worker
  // cache would otherwise mask hot reloads.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const register = () => {
      navigator.serviceWorker
        .register(`${basePath}/sw.js`, { scope: `${basePath}/` })
        .catch(() => {
          /* offline support is best-effort; the console still works online */
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  // Drain on mount, reconnect, returning to the tab, and periodically while
  // the app stays open. Background Sync is not available across browsers, so
  // the app-level timer is the reliable fallback.
  useEffect(() => {
    void runFlush();

    const onVisible = () => {
      if (document.visibilityState === "visible") void runFlush();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const timer = window.setInterval(() => {
      if (navigator.onLine) void runFlush();
    }, 60_000);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.clearInterval(timer);
    };
  }, [runFlush]);

  if (online && summary.total === 0) return null;

  const pendingLabel = `${summary.total} ${
    summary.total === 1 ? "change" : "changes"
  }`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-[60] sm:left-4 sm:right-auto sm:w-[22rem]"
    >
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl px-4 py-3 shadow-[0_16px_40px_-16px_rgba(88,28,135,0.5)] ring-1 backdrop-blur",
          online
            ? "bg-white/95 text-slate-700 ring-slate-200 dark:bg-[#160b2b]/95 dark:text-slate-200 dark:ring-white/10"
            : "bg-amber-50/95 text-amber-950 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/25"
        )}
      >
        {online ? (
          <RefreshCw
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400",
              syncing && "animate-spin"
            )}
            aria-hidden="true"
          />
        ) : (
          <WifiOff
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-none">
            {online ? (syncing ? "Syncing with Pulse…" : "Waiting to sync") : "You're offline"}
          </p>
          <p className="mt-1 text-[12px] leading-snug opacity-80">
            {online
              ? `${pendingLabel} saved on this device will sync automatically.`
              : summary.total > 0
                ? `Everything is saved on this device. ${pendingLabel} waiting to sync.`
                : "Everything is saved on this device and syncs when you reconnect."}
          </p>
        </div>
        {online && (
          <button
            type="button"
            onClick={() => void runFlush()}
            disabled={syncing}
            className="mt-0.5 shrink-0 rounded-md border border-purple-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-purple-700 transition-colors hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-500/25 dark:bg-transparent dark:text-purple-300 dark:hover:bg-purple-500/10"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
