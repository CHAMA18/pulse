import { getApp, getApps, initializeApp, FirebaseError, type FirebaseApp } from "firebase/app";
import {
  getAnalytics,
  isSupported,
  logEvent,
  type Analytics,
} from "firebase/analytics";
import { getAuth, GoogleAuthProvider, type Auth, type User } from "firebase/auth";

/**
 * Firebase web app configuration — "pharmacy-system-2fb27".
 *
 * These values are public client-side identifiers by design (Firebase security
 * is enforced by Security Rules and authorized domains, not by hiding these),
 * so it is safe to keep them in source, exactly as the Firebase console
 * snippet provides them.
 */
const firebaseConfig = {
  apiKey: "AIzaSyBqn_Bwk4xPtBVW-2VlVNBRFaxtyquP8ak",
  authDomain: "pharmacy-system-2fb27.firebaseapp.com",
  projectId: "pharmacy-system-2fb27",
  storageBucket: "pharmacy-system-2fb27.appspot.com",
  messagingSenderId: "383121081031",
  appId: "1:383121081031:web:aa20a504fbfc44f934b4e2",
  measurementId: "G-WK3493Q779",
};

let app: FirebaseApp | null = null;
let analyticsPromise: Promise<Analytics | null> | null = null;

/**
 * Returns the shared Firebase app instance (lazily initialized, browser only).
 * Safe to call repeatedly — reuses the existing app via getApps().
 */
export function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === "undefined") return null; // never init on the server
  if (!app) {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  return app;
}

/**
 * Initializes Firebase Analytics once per session.
 *
 * - Browser-only and lazy (Analytics is not supported during SSR)
 * - Resolves to null when unsupported (e.g. no IndexedDB) or blocked,
 *   so callers never have to handle failures
 */
export function initAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then((supported) => {
        const application = getFirebaseApp();
        if (!supported || !application) return null;
        return getAnalytics(application);
      })
      .catch(() => null); // analytics must never break the UX
  }
  return analyticsPromise;
}

/**
 * Fires a custom Analytics event (no-op on the server or when Analytics
 * is unavailable). Use it for product funnels, e.g. login flows.
 */
export async function trackEvent(
  name: string,
  params?: Record<string, unknown>
): Promise<void> {
  const analytics = await initAnalytics();
  if (!analytics) return;
  try {
    logEvent(analytics, name, params);
  } catch {
    /* swallow — telemetry failures are never user-facing */
  }
}

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

/**
 * Returns the shared Firebase Auth instance (browser only).
 * Persistence defaults to local; use setPersistence() to vary per sign-in.
 */
export function getFirebaseAuth(): Auth | null {
  const application = getFirebaseApp();
  if (!application) return null;
  return getAuth(application);
}

/** Google sign-in provider (used with signInWithPopup). */
export const googleProvider = new GoogleAuthProvider();

/**
 * Admin eligibility check, applied when signing in through the Admin portal.
 * Two mechanisms, in order of strength:
 *  1. A custom claim `admin: true` (set via the Firebase Admin SDK — recommended)
 *  2. The NEXT_PUBLIC_ADMIN_EMAILS allowlist (comma-separated emails), a
 *     pragmatic fallback while claims aren't set up yet
 * Returns false when neither matches so the caller can refuse the session.
 */
export async function isAdminUser(user: User): Promise<boolean> {
  try {
    const token = await user.getIdTokenResult();
    if (token.claims.admin === true) return true;
  } catch {
    /* fall through to the allowlist */
  }
  const allowlist = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return !!user.email && allowlist.includes(user.email.toLowerCase());
}

const AUTH_ERROR_COPY: Record<string, string> = {
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/missing-password": "Enter your password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-disabled": "This account has been disabled. Contact your administrator.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "We couldn't reach the authentication service. Check your connection.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow popups for this site and try again.",
  "auth/popup-closed-by-user": "Google sign-in was cancelled before it finished.",
  "auth/cancelled-popup-request": "Google sign-in was cancelled.",
  "auth/operation-not-allowed":
    "This sign-in method isn't enabled yet. Turn it on in Firebase Console → Authentication → Sign-in method.",
  "auth/configuration-not-found":
    "Email/password sign-in isn't configured yet. Enable it in Firebase Console → Authentication → Sign-in method.",
  "auth/unauthorized-domain":
    "This domain isn't authorized for sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains.",
  "auth/user-token-expired": "Your session expired. Please sign in again.",
};

/** Maps a Firebase auth failure to friendly, actionable copy. */
export function describeAuthError(err: unknown): string {
  if (err instanceof FirebaseError) {
    return AUTH_ERROR_COPY[err.code] ?? "Sign-in failed. Please try again.";
  }
  return "We couldn't reach the authentication service. Please try again.";
}

/** Firebase error code (or a generic tag) — handy for analytics params. */
export function authErrorCode(err: unknown): string {
  if (err instanceof FirebaseError) return err.code;
  return "unknown";
}
