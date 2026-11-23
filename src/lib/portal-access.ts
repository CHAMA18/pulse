import type { Portal } from "@/lib/portal";

/* ------------------------------------------------------------------ */
/* Portal access                                                       */
/* ------------------------------------------------------------------ */
/* An account belongs to exactly one console. The `account_type` on   */
/* the server-owned User profile is the authority — never the portal  */
/* toggle, the stored portal preference, or the role label (both      */
/* portals use "owner", so a role can never distinguish them).        */

export type AccountType = "Pulse" | "Pharmacy";

export type PortalAccess =
  | { status: "allowed"; portal: Portal; accountType: AccountType }
  | { status: "revoked" }
  | { status: "unassigned" }
  | { status: "unverified" };

export type PortalProfile = {
  account_type?: unknown;
  access_revoked?: unknown;
} | null | undefined;

/** Normalizes the stored account type ("Pulse", "pharmacy", …). */
export function normalizeAccountType(value: unknown): AccountType | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "pulse") return "Pulse";
  if (normalized === "pharmacy") return "Pharmacy";
  return null;
}

/** The console an account type belongs to. */
export function portalForAccountType(type: AccountType | null): Portal | null {
  if (type === "Pulse") return "pulse";
  if (type === "Pharmacy") return "pharmacy";
  return null;
}

/** Human label for the portal, used in sign-in copy. */
export function portalDisplayName(portal: Portal): string {
  return portal === "pharmacy" ? "Pharmacy portal" : "Pulse console";
}

/** Sign-in copy for a session that cannot enter either console. */
export function portalAccessError(
  status: "revoked" | "unassigned" | "unverified"
): string {
  if (status === "revoked") {
    return "Access to this account was removed. Ask an administrator if you think this is a mistake.";
  }
  if (status === "unassigned") {
    return "This account isn't assigned to a portal yet. Ask an administrator to set its account type.";
  }
  return "We couldn't verify which portal this account belongs to. Check your connection and try again.";
}

/**
 * Decides which console a session may enter.
 *
 * - `verified` says the profile (or a trusted claim) was actually read.
 *   When it wasn't, access fails closed as `unverified` so an offline or
 *   rules-denied read never silently grants a console.
 * - `access_revoked` always wins, including over a valid account type.
 */
export function evaluatePortalAccess(input: {
  profile: PortalProfile;
  verified: boolean;
}): PortalAccess {
  if (input.profile?.access_revoked === true) return { status: "revoked" };
  const accountType = normalizeAccountType(input.profile?.account_type);
  const portal = portalForAccountType(accountType);
  if (accountType && portal) return { status: "allowed", portal, accountType };
  return input.verified ? { status: "unassigned" } : { status: "unverified" };
}
