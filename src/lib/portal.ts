"use client";

/* ------------------------------------------------------------------ */
/* Portal session                                                      */
/* ------------------------------------------------------------------ */
/* The app has two post-authentication experiences: the Pulse admin    */
/* console (/dashboard) and the Pharmacy portal console (/pharmacy).   */
/* The portal is resolved from the account (or its invitation) and     */
/* persisted so a restored session opens the matching interface.       */

import type { Portal } from "@/lib/account-policy";

export type { Portal };

const PORTAL_STORAGE_KEY = "pulse.portal.v1";

/** Reads the portal the current session signed in through (null if unknown). */
export function getStoredPortal(): Portal | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PORTAL_STORAGE_KEY);
    return raw === "pulse" || raw === "pharmacy" ? raw : null;
  } catch {
    return null;
  }
}

/** Records the portal resolved at sign-in / registration. */
export function setStoredPortal(portal: Portal): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PORTAL_STORAGE_KEY, portal);
  } catch {
    /* persistence is best-effort */
  }
}

/** Clears the recorded portal (on sign-out). */
export function clearStoredPortal(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PORTAL_STORAGE_KEY);
  } catch {
    /* cleanup is best-effort */
  }
}

/** The dashboard route for a portal — where a session lands after auth. */
export function routeForPortal(portal: Portal): string {
  return portal === "pharmacy" ? "/pharmacy" : "/dashboard";
}
