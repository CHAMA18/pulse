"use client";

/* ------------------------------------------------------------------ */
/* Audit log — live activity feed for the console                      */
/* Firestore is the source of truth; localStorage keeps a small recent */
/* cache so the page can render instantly/offline. Events are queued   */
/* and flushed to Firestore in batches.                                */
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
const AUDIT_PENDING_KEY = "pulse.audit.pending.v1";
const AUDIT_RECENT_CACHE_CAP = 500;
const AUDIT_PENDING_CAP = 2_000;

/** Audit trails are per-pharmacy: scoped to the active pharmacy when one is set. */
function auditScope(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem("pulse.active-pharmacy.v1") ?? "";
  } catch {
    return "";
  }
}

function auditKey(): string {
  const scope = auditScope();
  return scope ? `${AUDIT_STORAGE_KEY}:${scope}` : AUDIT_STORAGE_KEY;
}

function pendingKey(): string {
  const scope = auditScope();
  return scope ? `${AUDIT_PENDING_KEY}:${scope}` : AUDIT_PENDING_KEY;
}

export const AUDIT_EVENT_NAME = "pulse:audit";
export const WORKSPACE_NAME = "Pulse workspace";

function isValidEvent(e: unknown): e is AuditEvent {
  return (
    !!e &&
    typeof e === "object" &&
    typeof (e as AuditEvent).id === "string" &&
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

function loadPending(): AuditEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(pendingKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidEvent) : [];
  } catch {
    return [];
  }
}

function savePending(events: AuditEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      pendingKey(),
      JSON.stringify(events.slice(0, AUDIT_PENDING_CAP))
    );
  } catch {
    /* pending queue is best-effort; Firestore remains authoritative */
  }
}

/** Recent local cache. Used for the first paint and offline fallback. */
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

let flushTimer: number | null = null;
let flushing = false;

function scheduleAuditFlush(): void {
  if (typeof window === "undefined" || flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushAuditQueue();
  }, 900);
}

/**
 * Send queued events to Firestore in one callable batch. Failed batches stay
 * queued and are retried on the next record/refresh.
 */
export async function flushAuditQueue(): Promise<void> {
  if (flushing) return;
  const pending = loadPending();
  if (pending.length === 0) return;

  flushing = true;
  try {
    const { recordAuditEvents } = await import("@/lib/cloud/audit-logs");
    await recordAuditEvents(pending);
    const sent = new Set(pending.map((event) => event.id));
    savePending(loadPending().filter((event) => !sent.has(event.id)));
  } catch {
    /* offline or function unavailable — keep the queue for the next attempt */
  } finally {
    flushing = false;
  }
}

/** Append a live event locally, then queue it for Firestore. */
export function recordAudit(event: {
  title: string;
  action: AuditAction;
  actor: string;
  detail?: string;
  email: string;
}): void {
  if (typeof window === "undefined") return;
  const entry: AuditEvent = {
    id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: event.title,
    action: event.action,
    actor: event.actor,
    detail: event.detail ?? WORKSPACE_NAME,
    email: event.email,
    ts: Date.now(),
  };

  try {
    const events = loadAuditEvents();
    window.localStorage.setItem(
      auditKey(),
      JSON.stringify([entry, ...events].slice(0, AUDIT_RECENT_CACHE_CAP))
    );
  } catch {
    /* recent cache full or unavailable — Firestore still receives the event */
  }

  savePending([entry, ...loadPending()].slice(0, AUDIT_PENDING_CAP));
  scheduleAuditFlush();
  window.dispatchEvent(new CustomEvent(AUDIT_EVENT_NAME));
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
