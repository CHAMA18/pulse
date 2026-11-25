import { getApp, getApps, initializeApp, FirebaseError, type FirebaseApp } from "firebase/app";
import {
  getAnalytics,
  isSupported,
  logEvent,
  type Analytics,
} from "firebase/analytics";
import {
  getAuth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  sendPasswordResetEmail,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";
import {
  doc,
  connectFirestoreEmulator,
  getDoc,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from "firebase/functions";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { isPulseAdminEmail } from "@/lib/account-policy";
import { recordAudit } from "@/lib/audit-log";
import {
  evaluatePortalAccess,
  normalizeAccountType,
  type PortalAccess,
  type PortalProfile,
} from "@/lib/portal-access";

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
let auth: Auth | null = null;
let cloudFunctions: Functions | null = null;
let cloudStorage: FirebaseStorage | null = null;

let analyticsPromise: Promise<Analytics | null> | null = null;

const STOCK_SANDBOX_PROJECT_ID = "demo-pulse-stock-sandbox";

export function isStockSandboxEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS !== "true") return false;
  if (typeof window === "undefined") return false;
  if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    throw new Error("The stock sandbox can only run on localhost.");
  }
  return true;
}

function emulatorHost(): string {
  return window.location.hostname;
}

/**
 * Returns the shared Firebase app instance (lazily initialized, browser only).
 * Safe to call repeatedly — reuses the existing app via getApps().
 */
export function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === "undefined") return null; // never init on the server
  if (!app) {
    const sandbox = isStockSandboxEnabled();
    const config = sandbox
      ? {
          ...firebaseConfig,
          projectId: STOCK_SANDBOX_PROJECT_ID,
          authDomain: `${STOCK_SANDBOX_PROJECT_ID}.firebaseapp.com`,
        }
      : firebaseConfig;
    app = getApps().length > 0 ? getApp() : initializeApp(config);
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
  if (!db) {
    try {
      // Persist the Firestore cache so profile reads work offline and writes
      // made while disconnected replay automatically once the network returns.
      db = initializeFirestore(application, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      // Private mode or an unsupported browser — fall back to the memory cache.
      db = getFirestore(application);
    }
    if (isStockSandboxEnabled()) connectFirestoreEmulator(db, emulatorHost(), 8080);
  }
  return db;
}

/** Region shared by every deployed Pulse callable (functions/src/index.ts). */
export const CLOUD_FUNCTIONS_REGION = "europe-west1";

/**
 * Returns the shared Cloud Functions client for the region the Pulse
 * callables are deployed to (lazily initialized, browser only).
 */
export function getFirebaseFunctions(): Functions | null {
  const application = getFirebaseApp();
  if (!application) return null; // never init on the server
  if (!cloudFunctions) {
    cloudFunctions = getFunctions(application, CLOUD_FUNCTIONS_REGION);
    if (isStockSandboxEnabled()) connectFunctionsEmulator(cloudFunctions, emulatorHost(), 5001);
  }
  return cloudFunctions;
}

/** Request evidence lives in Firebase Storage and follows the sandbox emulator. */
export function getFirebaseStorage(): FirebaseStorage | null {
  const application = getFirebaseApp();
  if (!application) return null;
  if (!cloudStorage) {
    cloudStorage = getStorage(application);
    if (isStockSandboxEnabled()) connectStorageEmulator(cloudStorage, emulatorHost(), 9199);
  }
  return cloudStorage;
}

/**
 * Initializes Firebase Analytics once per session.
 *
 * - Browser-only and lazy (Analytics is not supported during SSR)
 * - Resolves to null when unsupported (e.g. no IndexedDB) or blocked,
 *   so callers never have to handle failures
 */
export function initAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined" || isStockSandboxEnabled()) return Promise.resolve(null);
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
  pulse_admin_registered: { title: "Pulse Admin Registered", action: "Update" },
  user_added: { title: "User Added", action: "Update" },
  user_role_changed: { title: "User Role Changed", action: "Update" },
  user_status_changed: { title: "User Status Changed", action: "Update" },
  user_removed: { title: "User Removed", action: "Update" },
  pharmacy_status_changed: { title: "Pharmacy Status Changed", action: "Update" },
  pharmacy_deleted: { title: "Pharmacy Deleted", action: "Update" },
  pharmacies_bulk_deleted: { title: "Duplicate Pharmacies Deleted", action: "Update" },
  pharmacy_restored: { title: "Pharmacy Restored", action: "Update" },
  pharmacy_hard_deleted: { title: "Pharmacy Permanently Deleted", action: "Update" },
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
  if (!auth) {
    auth = getAuth(application);
    if (isStockSandboxEnabled()) {
      connectAuthEmulator(auth, `http://${emulatorHost()}:9099`, { disableWarnings: true });
    }
  }
  return auth;
}

/** Google sign-in provider (used with signInWithPopup). */
export const googleProvider = new GoogleAuthProvider();

/**
 * Resolves which console a signed-in account may enter.
 *
 * The `User/{uid}` profile is authoritative (it carries `account_type` and
 * `access_revoked`). A custom claim named `account_type` is honoured only
 * when the profile cannot be read, and a failed read with no claim fails
 * closed as `unverified`. The portal toggle and the stored portal value are
 * never consulted: both consoles use a role called "owner", so a role label
 * cannot tell a Pulse administrator from a pharmacy owner.
 */
/**
 * Reads the signed-in caller's profile through the server when the browser's
 * Firestore read fails (offline, a blocked request, or a suspended tab holding
 * the persistent-cache lease). The callable authenticates with the same ID
 * token and reads with the Admin SDK, so it does not depend on the local cache.
 */
async function readPortalProfileFromServer(): Promise<{
  profile: PortalProfile;
  verified: boolean;
}> {
  const functions = getFirebaseFunctions();
  if (!functions) return { profile: null, verified: false };
  try {
    const callable = httpsCallable<
      Record<string, never>,
      { exists: boolean; accountType: string | null; accessRevoked: boolean }
    >(functions, "resolveMyPortalAccess");
    const { data } = await callable({});
    if (!data || data.exists !== true) return { profile: null, verified: true };
    return {
      profile: {
        account_type: data.accountType ?? undefined,
        access_revoked: data.accessRevoked === true,
      },
      verified: true,
    };
  } catch {
    return { profile: null, verified: false };
  }
}

/**
 * Reads the caller's profile, answering from the local cache when it can and
 * asking the server when it cannot. A single failed read must not strand a
 * signed-in user on the "couldn't verify" screen.
 */
async function readPortalProfile(user: User): Promise<{
  profile: PortalProfile;
  verified: boolean;
}> {
  const store = getFirebaseDb();
  if (store) {
    try {
      const snap = await getDoc(doc(store, "User", user.uid));
      return { profile: (snap.data() as PortalProfile) ?? null, verified: true };
    } catch (error) {
      // Keep the reason in the console so a recurring failure is diagnosable.
      console.warn("Portal profile read failed; asking the server instead.", error);
    }
  }
  return readPortalProfileFromServer();
}

export async function resolvePortalAccess(user: User): Promise<PortalAccess> {
  const { profile, verified } = await readPortalProfile(user);
  if (verified) return evaluatePortalAccess({ profile, verified: true });

  try {
    const token = await user.getIdTokenResult();
    const claimed = normalizeAccountType(token.claims.account_type);
    if (claimed) {
      return evaluatePortalAccess({ profile: { account_type: claimed }, verified: false });
    }
  } catch {
    /* no claim available — fail closed below */
  }

  return { status: "unverified" };
}

/* ------------------------------------------------------------------ */
/* Pulse admin profile provisioning                                   */
/* ------------------------------------------------------------------ */

async function provisionPulseProfile(user: User, name?: string): Promise<boolean> {
  const functions = getFirebaseFunctions();
  if (!functions || !isPulseAdminEmail(user.email)) return false;
  try {
    const callable = httpsCallable<{ name: string }, { ok: boolean }>(
      functions,
      "ensurePulseAdminProfile"
    );
    const response = await callable({ name: name?.trim() || user.displayName?.trim() || "" });
    return response.data.ok === true;
  } catch {
    return false;
  }
}

/** Creates the first Pulse profile only through the server-side allowlist. */
export async function ensurePulseAdminProfile(user: User): Promise<boolean> {
  if (!isPulseAdminEmail(user.email)) return false;
  return provisionPulseProfile(user);
}

export type PulseAdminRegistrationInput = {
  name: string;
  email: string;
  password: string;
};

export type PulseAdminRegistrationResult = {
  uid: string;
  email: string;
  name: string;
  profileSaved: boolean;
};

export async function registerPulseAdminAccount(
  input: PulseAdminRegistrationInput
): Promise<PulseAdminRegistrationResult> {
  const email = input.email.trim().toLowerCase();
  if (!isPulseAdminEmail(email)) {
    throw new FirebaseError(
      "auth/restricted-email",
      "This email isn't eligible for a Pulse admin account."
    );
  }
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new FirebaseError("auth/unavailable", "Authentication isn't available right now.");
  }

  const credential = await createUserWithEmailAndPassword(auth, email, input.password);
  const user = credential.user;
  const name = input.name.trim() || email.split("@")[0];
  try {
    await updateProfile(user, { displayName: name });
  } catch {
    /* The server falls back to the email local part. */
  }
  await user.getIdToken(true);
  const profileSaved = await provisionPulseProfile(user, name);
  if (!profileSaved) {
    throw new FirebaseError(
      "auth/network-request-failed",
      "Pulse couldn't securely assign this account. Try signing in again in a moment."
    );
  }
  return { uid: user.uid, email, name, profileSaved: true };
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

/**
 * The pharmacy registrations made on this browser, keyed by uid.
 * The Pharmacy portal console reads this to show the signed-in owner's
 * own pharmacy profile (name, owner, when it registered).
 */
export function getPharmacyRegistrations(): PharmacyRegistration[] {
  return readPharmacyRegistry();
}

/* ------------------------------------------------------------------ */
/* Invitation acceptance                                               */
/* ------------------------------------------------------------------ */

export type InvitedAccountInput = {
  name: string;
  email: string;
  password: string;
  role: string;
  kind: "team" | "console";
  pharmacyName?: string | null;
};

export type InvitedAccountResult = {
  uid: string;
  email: string;
  name: string;
  kind: "team" | "console";
};

/**
 * Creates the Firebase Auth account for someone who arrived through an
 * invitation. The account profile is deliberately NOT written here: account
 * type and role come from the server's `acceptInvitation` callable, which
 * reads the invitation record. That stops a browser from assigning itself
 * `account_type` or a role when it registers.
 */
export async function registerInvitedAccount(
  input: InvitedAccountInput
): Promise<InvitedAccountResult> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new FirebaseError("auth/unavailable", "Authentication isn't available right now.");
  }

  const email = input.email.trim().toLowerCase();
  const credential = await createUserWithEmailAndPassword(auth, email, input.password);
  const user = credential.user;
  const name = input.name.trim() || email.split("@")[0];
  try {
    await updateProfile(user, { displayName: name });
    // Refresh the ID token so acceptInvitation can read the new display name.
    await user.getIdToken(true);
  } catch {
    /* the invitation profile falls back to the email local part */
  }

  return { uid: user.uid, email, name, kind: input.kind };
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
 *     app reads (`account_type: "Pharmacy"`, `role: "owner"`, and a
 *     pending listing that Pulse can review before it becomes active).
 *
 * The Firestore write is constrained by security rules to this exact
 * self-registration shape, so the browser can never assign `Pulse` or an
 * arbitrary role. Failures fall back to the local registry for display only;
 * they never grant portal access.
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
        pharmacy_id: user.uid,
        approved_by_duniya: false,
        access_revoked: false,
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

/**
 * Emails a Firebase password-reset link to an existing account. Used by the
 * Pulse console when an Owner/Admin triggers a reset for a user.
 */
export async function sendPasswordResetLink(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new FirebaseError("auth/unavailable", "Authentication isn't available right now.");
  }
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new FirebaseError("auth/invalid-email", "That email address doesn't look right.");
  }
  await sendPasswordResetEmail(auth, address);
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
  "auth/restricted-email":
    "Only Duniya Healthcare emails and chungu424@gmail.com can create a Pulse admin account.",
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
