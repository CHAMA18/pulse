import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAnalytics,
  isSupported,
  logEvent,
  type Analytics,
} from "firebase/analytics";

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
