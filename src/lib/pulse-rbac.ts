/* ------------------------------------------------------------------ */
/* Pulse console RBAC — one source of truth for roles and page access   */
/* ------------------------------------------------------------------ */

export type PulseRole = "owner" | "admin" | "staff";

export type PulsePage =
  | "home"
  | "pharmacies"
  | "requests"
  | "reconciliation"
  | "sales"
  | "transactions"
  | "catalogue"
  | "inventory"
  | "movement"
  | "stock"
  | "users"
  | "audit"
  | "walkthrough";

export const PULSE_ROLE_META: Record<
  PulseRole,
  { label: string; pill: string }
> = {
  owner: {
    label: "Owner",
    pill: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  },
  admin: {
    label: "Admin",
    pill: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  },
  staff: {
    label: "Staff",
    pill: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  },
};

export const ALL_PULSE_PAGES: readonly PulsePage[] = [
  "home",
  "audit",
  "users",
  "pharmacies",
  "requests",
  "reconciliation",
  "sales",
  "transactions",
  "catalogue",
  "inventory",
  "movement",
  "stock",
  "walkthrough",
];

/**
 * Staff run the day-to-day operation — keeping the warehouse catalogue and
 * its movement ledger up to date, and watching the network's stock picture.
 * The admin record, account management and financial sales reporting stay
 * with Owners and Admins.
 */
export const PULSE_ROLE_PAGES: Record<PulseRole, ReadonlySet<PulsePage>> = {
  owner: new Set(ALL_PULSE_PAGES),
  admin: new Set(ALL_PULSE_PAGES),
  staff: new Set<PulsePage>([
    "home",
    "pharmacies",
    "requests",
    "reconciliation",
    "catalogue",
    "inventory",
    "movement",
    "stock",
    "walkthrough",
  ]),
};

export function canOpenPulsePage(role: PulseRole, page: PulsePage): boolean {
  return PULSE_ROLE_PAGES[role].has(page);
}

export function normalizePulseRole(
  value: string | null | undefined
): PulseRole | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "owner") return "owner";
  if (normalized === "admin" || normalized === "administrator") return "admin";
  if (normalized === "staff" || normalized === "member" || normalized === "user")
    return "staff";
  return undefined;
}

/** Owners and Admins manage console accounts; Staff may not. */
export function canManageConsoleUsers(role: PulseRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Owners may edit anyone but themselves. Admins may edit anyone but
 * themselves and other Owners — an Owner's row is Owner-only territory.
 */
export function canChangePulseRole(
  actorRole: PulseRole,
  actorUid: string,
  targetUid: string,
  targetRole?: PulseRole
): boolean {
  if (!canManageConsoleUsers(actorRole) || !actorUid || actorUid === targetUid) return false;
  return actorRole === "owner" || targetRole !== "owner";
}

/** Owners may remove anyone but themselves; Admins anyone but themselves and Owners. */
export function canRemovePulseUser(
  actorRole: PulseRole,
  actorUid: string,
  targetUid: string,
  targetRole?: PulseRole
): boolean {
  if (!canManageConsoleUsers(actorRole) || !actorUid || actorUid === targetUid) return false;
  return actorRole === "owner" || targetRole !== "owner";
}

/**
 * Roles an actor may hand out when inviting someone. Admins can add Admins and
 * Staff, but only Owners can create another Owner.
 */
export function assignablePulseRoles(role: PulseRole): PulseRole[] {
  if (role === "owner") return ["owner", "admin", "staff"];
  if (role === "admin") return ["admin", "staff"];
  return [];
}
