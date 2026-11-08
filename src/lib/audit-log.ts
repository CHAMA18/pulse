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
export const AUDIT_EVENT_NAME = "pulse:audit";
const AUDIT_CAP = 500;

/** The workspace id mirrored from the live console's audit trail. */
export const WORKSPACE_USER_REF = "User: PkP5vTnIysYgIPCMRkzCPbaepbJ3";
export const WORKSPACE_NAME = "Pulse workspace";

/** The four people every fresh console opens with. */
const SEED_ACTORS: { name: string; email: string }[] = [
  { name: "Chungu Chipimo Chama", email: "chungu424@gmail.com" },
  { name: "Chungu Chama", email: "chungu90@thestackone.com" },
  { name: "E2E PO", email: "popo1790656699@uberip.com" },
  { name: "GRImp Owner", email: "grimp1790659419@uberip.com" },
];

const VIEWED_PAGES = [
  "Audit Logs", "Pulse Pharmacies", "User Management", "Stock Balance",
  "Supplier Management", "Dashboard", "Home",
] as const;

const TAP_TARGETS = ["Home", "Pulse Pharmacies", "Audit Logs", "User Management"] as const;

type SeedEvent = {
  title: string;
  action: AuditAction;
  detail: string;
};

function seedEventFor(i: number): SeedEvent {
  // The first five mirror the live console exactly; the rest are generated.
  switch (i) {
    case 0:
      return { title: "Viewed Audit Logs", action: "View", detail: WORKSPACE_NAME };
    case 1:
      return { title: "Viewed Pulse Pharmacies", action: "View", detail: WORKSPACE_NAME };
    case 2:
      return { title: "Sidebar navigation", action: "View", detail: WORKSPACE_USER_REF };
    case 3:
      return { title: "Sidebar selection", action: "Update", detail: WORKSPACE_USER_REF };
    case 4:
      return { title: "Tapped Home in the sidebar", action: "Activity", detail: WORKSPACE_USER_REF };
    default: {
      const kind = i % 5;
      if (kind === 0 || kind === 1) {
        const page = VIEWED_PAGES[(i * 7) % VIEWED_PAGES.length];
        return { title: `Viewed ${page}`, action: "View", detail: WORKSPACE_NAME };
      }
      if (kind === 2) {
        return { title: "Sidebar navigation", action: "View", detail: WORKSPACE_USER_REF };
      }
      if (kind === 3) {
        return { title: "Sidebar selection", action: "Update", detail: WORKSPACE_USER_REF };
      }
      const target = TAP_TARGETS[(i * 3) % TAP_TARGETS.length];
      return { title: `Tapped ${target} in the sidebar`, action: "Activity", detail: WORKSPACE_USER_REF };
    }
  }
}

/** 250 events: the first 15 land within the last hour (today), the rest
 *  spread back over ~30 days — exactly mirroring the live console. */
function seedAuditEvents(now: number): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (let i = 0; i < 250; i += 1) {
    const { title, action, detail } = seedEventFor(i);
    const actor = SEED_ACTORS[i % 2 === 0 ? 0 : Math.floor(i / 3) % 4];
    // First five mirror the live console's timestamps ("Just now", "1h ago"…);
    // events 6-15 fill out the last 24h, the rest spread back over ~28 days.
    const minute =
      i === 0
        ? 0.3
        : i < 5
          ? 60 + i * 1.5
          : i < 15
            ? 120 + (i - 5) * 80
            : 1500 + (i - 15) * 162;
    events.push({
      id: `aud-seed-${String(i).padStart(3, "0")}`,
      title,
      action,
      actor: actor.name,
      detail,
      email: actor.email,
      ts: now - Math.round(minute * 60 * 1000),
    });
  }
  return events;
}

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
    const raw = window.localStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return seedAuditEvents(Date.now());
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return seedAuditEvents(Date.now());
    let migrated = false;
    const events = parsed
      .filter(isValidEvent)
      .map((e) => {
        const title = humanizeLegacyTitle(e.title);
        if (title !== e.title) migrated = true;
        return title === e.title ? e : { ...e, title };
      });
    if (migrated) {
      try {
        window.localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(events));
      } catch {
        /* best-effort — the in-memory copy is already clean */
      }
    }
    return events;
  } catch {
    return seedAuditEvents(Date.now());
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
      AUDIT_STORAGE_KEY,
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
