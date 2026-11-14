"use client";

import { getFirebaseAuth } from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Last-known reads                                                    */
/* ------------------------------------------------------------------ */
/* Callables cannot answer while offline, so the dashboard keeps the   */
/* last successful response on the device. Views render that snapshot  */
/* with a timestamp instead of an error, then refresh when online.     */

const CACHE_PREFIX = "pulse.offline-read.v1";

export type CachedRead<T> = {
  data: T;
  /** Epoch ms of the successful network read. */
  cachedAt: number;
};

/** Snapshots are scoped to the signed-in account on this device. */
function cacheKey(key: string): string {
  let owner = "device";
  try {
    owner = getFirebaseAuth()?.currentUser?.uid || "device";
  } catch {
    /* auth not ready — a device-scoped snapshot is still better than none */
  }
  return `${CACHE_PREFIX}:${owner}:${key}`;
}

export function loadCachedRead<T>(key: string): CachedRead<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(key));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const entry = parsed as CachedRead<T>;
    if (typeof entry.cachedAt !== "number" || entry.data == null) return null;
    return entry;
  } catch {
    return null;
  }
}

export function saveCachedRead<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(key),
      JSON.stringify({ data, cachedAt: Date.now() } satisfies CachedRead<T>)
    );
  } catch {
    /* storage full or unavailable — live data still renders */
  }
}

export function formatCachedAt(cachedAt: number): string {
  return new Date(cachedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
