import { getApp, getApps, initializeApp, FirebaseError, type FirebaseApp } from "firebase/app";
import {
  getAnalytics,
  isSupported,
  logEvent,
  type Analytics,
} from "firebase/analytics";
import { getAuth, GoogleAuthProvider, createUserWithEmailAndPassword, updateProfile, type Auth, type User } from "firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { recordAudit } from "@/lib/audit-log";

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
let db: Firestore | null = null;
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
 * Returns the shared Firestore instance (lazily initialized, browser only).
 * Used for the `User` collection — the same documents the Pulse pharmacy
 * app reads, so an account registered on the web is recognized there too.
 */
export function getFirebaseDb(): Firestore | null {
  const application = getFirebaseApp();
  if (!application) return null; // never init on the server
  if (!db) db = getFirestore(application);
  return db;
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
 * Notable product events are mirrored into the local audit trail.
 */
export async function trackEvent(
  name: string,
  params?: Record<string, unknown>
): Promise<void> {
  mirrorTrackEventToAudit(name);
  const analytics = await initAnalytics();
  if (!analytics) return;
  try {
    logEvent(analytics, name, params);
  } catch {
    /* swallow — telemetry failures are never user-facing */
  }
}

/* ------------------------------------------------------------------ */
/* Audit trail mirroring                                               */
/* ------------------------------------------------------------------ */

/** Product events worth surfacing in the console's audit log. */
const AUDIT_MIRROR: Record<string, { title: string; action: "View" | "Update" | "Activity" }> = {
  pharmacy_registered: { title: "Pharmacy Registered", action: "Update" },
  user_added: { title: "User Added", action: "Update" },
  user_role_changed: { title: "User Role Changed", action: "Update" },
  user_status_changed: { title: "User Status Changed", action: "Update" },
  user_removed: { title: "User Removed", action: "Update" },
  pharmacy_status_changed: { title: "Pharmacy Status Changed", action: "Update" },
  pharmacies_imported: { title: "Pharmacies Imported", action: "Update" },
  pharmacies_template_downloaded: { title: "Registry Template Downloaded", action: "View" },
};

function mirrorTrackEventToAudit(name: string): void {
  const entry = AUDIT_MIRROR[name];
  if (!entry) return;
  try {
    const current = getFirebaseAuth()?.currentUser;
    const email = current?.email ?? "";
    if (!email) return; // can't attribute the event — skip
    recordAudit({
      title: entry.title,
      action: entry.action,
      actor: current?.displayName ?? email.split("@")[0],
      email,
    });
  } catch {
    /* audit mirroring is best-effort */
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
 * Elevated-access eligibility check, applied when signing in through the
 * Pharmacy portal (pharmacy administrators/staff with elevated rights).
 * Four mechanisms, in order of strength:
 *  1. A custom claim `admin: true` (set via the Firebase Admin SDK — recommended)
 *  2. The NEXT_PUBLIC_ADMIN_EMAILS allowlist (comma-separated emails), a
 *     pragmatic fallback while claims aren't set up yet
 *  3. The local pharmacy registration registry — an account created through
 *     "Register your pharmacy" on this browser is recognized immediately,
 *     even if its Firestore profile write was rejected by security rules
 *  4. The Firestore `User/{uid}` document with `account_type: "Pharmacy"` —
 *     the same document the Pulse pharmacy app reads, so an account that
 *     registered on the web (or any device) is recognized everywhere
 * Returns false when none match so the caller can refuse the session.
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
  if (user.email && allowlist.includes(user.email.toLowerCase())) return true;

  const registry = readPharmacyRegistry();
  const email = user.email?.toLowerCase();
  if (registry.some((r) => r.uid === user.uid || (email && r.email === email))) {
    return true;
  }

  const store = getFirebaseDb();
  if (store) {
    try {
      const snap = await getDoc(doc(store, "User", user.uid));
      const profile = snap.data() as { account_type?: string } | undefined;
      if (profile?.account_type === "Pharmacy") return true;
    } catch {
      /* Firestore unavailable or rules deny the read — registry already covered it */
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Pharmacy self-registration                                          */
/* ------------------------------------------------------------------ */

type PharmacyRegistration = {
  uid: string;
  email: string;
  pharmacyName: string;
  ownerName: string;
  at: string;
};

const PHARMACY_REGISTRY_KEY = "pulse.pharmacy-registrations.v1";

/** Reads the local pharmacy registry (this browser only). */
function readPharmacyRegistry(): PharmacyRegistration[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PHARMACY_REGISTRY_KEY);
    const parsed = raw ? (JSON.parse(raw) as PharmacyRegistration[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persists one registration to the local registry (best-effort). */
function recordPharmacyRegistration(entry: PharmacyRegistration): void {
  try {
    const registry = readPharmacyRegistry().filter((r) => r.uid !== entry.uid);
    registry.push(entry);
    window.localStorage.setItem(PHARMACY_REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    /* registry is a fallback — never let it break registration */
  }
}

export type PharmacyRegistrationInput = {
  pharmacyName: string;
  ownerName: string;
  email: string;
  password: string;
};

export type PharmacyRegistrationResult = {
  uid: string;
  email: string;
  pharmacyName: string;
  ownerName: string;
  profileSaved: boolean;
};

/**
 * Registers a new pharmacy account end-to-end:
 *
 *  1. Creates the Firebase Auth account (email + password) and signs the
 *     new owner in.
 *  2. Sets the auth display name to the owner's name.
 *  3. Writes a `User/{uid}` profile in the exact shape the Pulse pharmacy
 *     app reads (`account_type: "Pharmacy"`, `role: "owner"`,
 *     `pharmacy_name`, `approved_by_duniya: false` — pending network
 *     review), so the same account works in the pharmacy app once
 *     provisioned there.
 *
 * The Firestore write is best-effort: security rules or an outage must not
 * lose an already-created Auth account, so failures fall back to the local
 * registry (mechanism 3 of [isAdminUser]) and the caller still gets success.
 *
 * Errors thrown before the Auth account exists are Firebase auth errors the
 * caller maps to friendly copy (see describeAuthError).
 */
export async function registerPharmacyAccount(
  input: PharmacyRegistrationInput
): Promise<PharmacyRegistrationResult> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new FirebaseError("auth/unavailable", "Authentication isn't available right now.");
  }

  const email = input.email.trim().toLowerCase();
  const credential = await createUserWithEmailAndPassword(auth, email, input.password);
  const user = credential.user;

  let ownerName = input.ownerName.trim();
  try {
    await updateProfile(user, { displayName: ownerName });
  } catch {
    ownerName = user.email?.split("@")[0] ?? ownerName;
  }

  const pharmacyName = input.pharmacyName.trim();
  let profileSaved = false;
  const store = getFirebaseDb();
  if (store) {
    try {
      await setDoc(doc(store, "User", user.uid), {
        email,
        uid: user.uid,
        display_name: ownerName,
        created_time: serverTimestamp(),
        role: "owner",
        account_type: "Pharmacy",
        pharmacy_name: pharmacyName,
        approved_by_duniya: false, // pending Pulse network review
      });
      profileSaved = true;
    } catch {
      /* rules or offline — the registry fallback below keeps the account usable */
    }
  }

  const registration: PharmacyRegistrationResult = {
    uid: user.uid,
    email,
    pharmacyName,
    ownerName,
    profileSaved,
  };
  recordPharmacyRegistration({
    uid: user.uid,
    email,
    pharmacyName,
    ownerName,
    at: new Date().toISOString(),
  });
  return registration;
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
