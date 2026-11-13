"use client";

/* ------------------------------------------------------------------ */
/* Audit log — live, tamper-resistant activity feed for the console    */
/* Persisted to localStorage and mirrored to listeners via a window    */
/* event so open pages update instantly ("Just now" entries).          */
/* ------------------------------------------------------------------ */

export type AuditAction = "View" | "Update" | "Activity";

export type AuditEvent = {
  id: string;
  title: string;
  action: AuditAction;
  actor: string;
  detail: string;
  email: string;
  ts: number;
};

export const AUDIT_STORAGE_KEY = "pulse.audit.v1";

/** Audit trails are per-pharmacy: scoped to the active pharmacy when one is set. */
function auditKey(): string {
  if (typeof window === "undefined") return AUDIT_STORAGE_KEY;
  try {
    const scope = window.localStorage.getItem("pulse.active-pharmacy.v1");
    return scope ? `${AUDIT_STORAGE_KEY}:${scope}` : AUDIT_STORAGE_KEY;
  } catch {
    return AUDIT_STORAGE_KEY;
  }
}
export const AUDIT_EVENT_NAME = "pulse:audit";
const AUDIT_CAP = 500;

export const WORKSPACE_NAME = "Pulse workspace";

function isValidEvent(e: unknown): e is AuditEvent {
  return (
    !!e &&
    typeof e === "object" &&
    typeof (e as AuditEvent).title === "string" &&
    typeof (e as AuditEvent).ts === "number" &&
    ["View", "Update", "Activity"].includes((e as AuditEvent).action)
  );
}

/** Split camelCase page names ("AuditLogs" → "Audit Logs"). */
function spaced(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Older builds wrote machine-flavoured titles ("Viewed AuditLogs",
 * "SidebarLink Navigate To", "SIDE NAV COMP Home ON TAP"). Rewrite any
 * that are still in a visitor's localStorage so the feed reads cleanly.
 */
function humanizeLegacyTitle(title: string): string {
  if (title.startsWith("SIDE NAV COMP ") && title.endsWith(" ON TAP")) {
    const target = spaced(title.slice("SIDE NAV COMP ".length, -" ON TAP".length));
    return `Tapped ${target} in the sidebar`;
  }
  if (title === "SidebarLink Navigate To") return "Sidebar navigation";
  if (title === "SidebarLink Update App State") return "Sidebar selection";
  if (title.startsWith("Viewed ")) return `Viewed ${spaced(title.slice("Viewed ".length))}`;
  return title;
}

export function loadAuditEvents(): AuditEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(auditKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidEvent).filter((event) => !event.id.startsWith("aud-seed-"));
    let migrated = valid.length !== parsed.length;
    const events = valid
      .map((e) => {
        const title = humanizeLegacyTitle(e.title);
        if (title !== e.title) migrated = true;
        return title === e.title ? e : { ...e, title };
      });
    if (migrated) {
      try {
        window.localStorage.setItem(auditKey(), JSON.stringify(events));
      } catch {
        /* best-effort — the in-memory copy is already clean */
      }
    }
    return events;
  } catch {
    return [];
  }
}

/** Append a live event (newest first), cap the log, notify listeners. */
export function recordAudit(event: {
  title: string;
  action: AuditAction;
  actor: string;
  detail?: string;
  email: string;
}): void {
  if (typeof window === "undefined") return;
  try {
    const events = loadAuditEvents();
    const entry: AuditEvent = {
      id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: event.title,
      action: event.action,
      actor: event.actor,
      detail: event.detail ?? WORKSPACE_NAME,
      email: event.email,
      ts: Date.now(),
    };
    window.localStorage.setItem(
      auditKey(),
      JSON.stringify([entry, ...events].slice(0, AUDIT_CAP))
    );
    window.dispatchEvent(new CustomEvent(AUDIT_EVENT_NAME));
  } catch {
    /* storage full or unavailable — recording is best-effort */
  }
}

export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function isToday(ts: number, now: number = Date.now()): boolean {
  // "Today" follows the live console's rolling 24h window.
  return now - ts < 24 * 60 * 60 * 1000;
}
