/**
 * Account policy — one source of truth for how a self-service email maps to
 * a Pulse account.
 *
 * Pulse admin accounts are reserved for Duniya Healthcare staff and the
 * designated administrator inbox. Every other self-service email creates a
 * Pharmacy account. An explicit invitation is the only thing that can change
 * that default, and it is applied authoritatively by the acceptInvitation
 * Cloud Function.
 *
 * Keep this module pure: it is imported by the login screen, the registration
 * dialog, and the Firebase session resolver.
 */

export type Portal = "pulse" | "pharmacy";

export type SelfServiceAccountKind = "pulse-admin" | "pharmacy";

/** The one non-domain inbox that may self-register a Pulse admin account. */
export const PULSE_ADMIN_EMAIL = "chungu424@gmail.com";

/** Every mailbox at this domain is a Pulse admin account. */
export const PULSE_ADMIN_DOMAIN = "duniyahealthcare.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

export function isValidEmail(email: string | null | undefined): boolean {
  return EMAIL_RE.test(normalizeEmail(email));
}

/**
 * Whether an email belongs to the Pulse admin console by policy.
 *
 * The domain match is exact, not a suffix: lookalikes such as
 * `mail.duniyahealthcare.com` and `duniyahealthcare.com.evil.example` are
 * deliberately rejected.
 */
export function isPulseAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) return false;
  if (normalized === PULSE_ADMIN_EMAIL) return true;
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return domain === PULSE_ADMIN_DOMAIN;
}

/**
 * The account a self-service registration should create.
 * Returns null until the address is valid, so the form can stay neutral.
 */
export function selfServiceAccountKind(
  email: string | null | undefined
): SelfServiceAccountKind | null {
  if (!isValidEmail(email)) return null;
  return isPulseAdminEmail(email) ? "pulse-admin" : "pharmacy";
}

/** The console a self-service account belongs to. */
export function portalForSelfServiceKind(
  kind: SelfServiceAccountKind
): Portal {
  return kind === "pulse-admin" ? "pulse" : "pharmacy";
}
