"use client";

import { motion } from "framer-motion";
import {
  CalendarDays,
  ClipboardList,
  Eye,
  History,
  NotebookPen,
  RefreshCw,
  Search,
  SearchX,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";
import {
  AUDIT_EVENT_NAME,
  flushAuditQueue,
  formatRelative,
  isToday,
  loadAuditEvents,
  type AuditAction,
  type AuditEvent,
} from "@/lib/audit-log";
import { listAuditLogs, recordAuditEvents } from "@/lib/cloud/audit-logs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

type TypeFilter = "all" | AuditAction;

const ACTION_META: Record<
  AuditAction,
  { icon: LucideIcon; tile: string; badge: string }
> = {
  View: {
    icon: Eye,
    tile: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
    badge: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  },
  Update: {
    icon: NotebookPen,
    tile: "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400",
    badge: "bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300",
  },
  Activity: {
    icon: Zap,
    tile: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
    badge: "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400",
  },
};

const PAGE_SIZE = 60;

/** Merge Firestore events with recent local events that are still queued. */
function mergeWithLocal(events: AuditEvent[]): AuditEvent[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  for (const event of loadAuditEvents()) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => b.ts - a.ts);
}

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function AuditLogs() {
  const { toast } = useToast();

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [, forceTick] = useState(0);

  const loadFeed = useCallback(async (backfill = false) => {
    await flushAuditQueue();
    const feed = await listAuditLogs();

    // Move any pre-Firestore history from this device into the shared trail.
    // The server only accepts events attributed to the signed-in email.
    if (backfill) {
      const remoteIds = new Set(feed.events.map((event) => event.id));
      const missing = loadAuditEvents().filter((event) => !remoteIds.has(event.id));
      if (missing.length > 0) {
        try {
          await recordAuditEvents(missing);
        } catch {
          /* keep the local copy; retry on the next page load */
        }
      }
    }

    return mergeWithLocal(feed.events);
  }, []);

  // Hydrate from Firestore, then fall back to the recent local cache when the
  // console is offline or the callable is unavailable.
  useEffect(() => {
    let active = true;
    const raf = requestAnimationFrame(() => {
      void loadFeed(true)
        .catch(() => mergeWithLocal([]))
        .then((next) => {
          if (!active) return;
          setEvents(next);
          setHydrated(true);
        });
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, [loadFeed]);

  // Live feed — navigation and mutations record themselves app-wide. The
  // debounce gives the queued Firestore batch time to land first.
  useEffect(() => {
    if (!hydrated) return;
    let timer: number | undefined;
    const onAudit = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadFeed()
          .then(setEvents)
          .catch(() => setEvents(mergeWithLocal([])));
      }, 1_200);
    };
    window.addEventListener(AUDIT_EVENT_NAME, onAudit);
    const tick = window.setInterval(() => forceTick((v) => v + 1), 30_000);
    return () => {
      window.removeEventListener(AUDIT_EVENT_NAME, onAudit);
      if (timer) window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, [hydrated, loadFeed]);

  /* ---------------- derived data ---------------- */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (typeFilter !== "all" && e.action !== typeFilter) return false;
      if (!q) return true;
      return `${e.title} ${e.actor} ${e.email} ${e.detail}`.toLowerCase().includes(q);
    });
  }, [events, query, typeFilter]);

  const stats = useMemo(() => {
    const now = Date.now();
    let today = 0;
    const people = new Set<string>();
    for (const e of events) {
      if (isToday(e.ts, now)) today += 1;
      people.add(e.email);
    }
    return { total: events.length, today, people: people.size };
  }, [events]);

  /* ---------------- mutations ---------------- */

  const refresh = () => {
    void loadFeed()
      .then((next) => {
        setEvents(next);
        setVisible(PAGE_SIZE);
        toast({
          title: "Activity refreshed",
          description: `${next.length} events re-synced from the audit trail.`,
        });
      })
      .catch(() => {
        toast({
          title: "Refresh failed",
          description: "The audit trail could not be reached. Showing local activity.",
          variant: "destructive",
        });
      });
    void trackEvent("audit_logs_refreshed");
  };

  /* ---------------- render ---------------- */

  const shown = filtered.slice(0, visible);

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col" data-tour="pulse-audit">
      {/* — Page header — */}
      <motion.section
        variants={item}
        aria-labelledby="audit-logs-title"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3.5">
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
              "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
            )}
          >
            <History className="h-6 w-6" strokeWidth={2.1} aria-hidden="true" />
          </span>
          <div>
            <h1
              id="audit-logs-title"
              className="text-[24px] font-bold tracking-tight text-slate-900 dark:text-white sm:text-[28px]"
            >
              Audit Logs
            </h1>
            <p className="mt-0.5 text-[13.5px] text-slate-500 dark:text-slate-400">
              A live, tamper-resistant record of activity across your organization.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-purple-200 bg-white px-5 text-[14px] font-semibold text-purple-600 shadow-sm transition-colors hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-purple-500/30 dark:bg-white/5 dark:text-purple-300 dark:hover:bg-purple-500/10"
        >
          <RefreshCw className="h-[17px] w-[17px]" aria-hidden="true" />
          Refresh activity
        </button>
      </motion.section>

      {/* — Stat cards — */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {(
          [
            { value: stats.total, label: "Total events", icon: ClipboardList },
            { value: stats.today, label: "Today", icon: CalendarDays },
            { value: stats.people, label: "Active people", icon: Users },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <motion.div key={label} variants={item} className={cn(cardCls, "flex items-center gap-4 p-5")}>
            <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
              <Icon className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="whitespace-nowrap text-[28px] font-bold leading-none tracking-tight text-slate-700 dark:text-slate-100">
                {value}
              </p>
              <p className="mt-1.5 whitespace-nowrap text-[14.5px] font-medium leading-none text-slate-500 dark:text-slate-400">
                {label}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* — Search & type filter — */}
      <motion.section variants={item} aria-label="Search and filters" className="mt-6">
        <div className={cn(cardCls, "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5")}>
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-purple-500"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(PAGE_SIZE);
              }}
              placeholder="Search events, people, or details"
              aria-label="Search audit events"
              className="h-12 w-full rounded-xl border border-transparent bg-slate-50 pl-11 pr-4 text-[14.5px] text-slate-900 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-slate-400 hover:border-slate-200 focus:border-purple-400 focus:bg-white focus:ring-4 focus:ring-purple-500/10 dark:border-transparent dark:bg-white/5 dark:text-white dark:hover:border-white/10 dark:focus:border-purple-400"
            />
          </div>

          <div className="flex flex-col gap-1 sm:w-44">
            <span className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400">
              Activity type
            </span>
            <Select
              value={typeFilter}
              onValueChange={(next) => {
                setTypeFilter(next as TypeFilter);
                setVisible(PAGE_SIZE);
                void trackEvent("audit_logs_filtered", { type: next });
              }}
            >
              <SelectTrigger
                aria-label="Filter by activity type"
                className="h-11 w-full rounded-xl border-slate-100 bg-slate-50 text-[14px] font-medium text-slate-800 shadow-none hover:border-slate-200 focus:ring-4 focus:ring-purple-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="View">View</SelectItem>
                <SelectItem value="Update">Update</SelectItem>
                <SelectItem value="Activity">Activity</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </motion.section>

      {/* — Activity feed — */}
      {!hydrated ? (
        <motion.div
          variants={item}
          aria-busy="true"
          className={cn(
            cardCls,
            "mt-6 flex min-h-[180px] flex-col items-center justify-center gap-2.5 p-8 text-center"
          )}
        >
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600"
            aria-hidden="true"
          />
          <p className="text-[13.5px] text-slate-500 dark:text-slate-400">
            Loading the audit trail…
          </p>
        </motion.div>
      ) : shown.length === 0 ? (
        <motion.div
          variants={item}
          className={cn(
            cardCls,
            "mt-6 flex min-h-[180px] flex-col items-center justify-center gap-3 p-8 text-center"
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5">
            <SearchX className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-slate-800 dark:text-white">
              No activity found
            </p>
            <p className="mt-1 text-[13.5px] text-slate-500 dark:text-slate-400">
              {query
                ? `Nothing matches “${query}”. Try a different event, person, or detail.`
                : "No events of this type yet — they'll appear here as the workspace is used."}
            </p>
          </div>
        </motion.div>
      ) : (
        <motion.section
          variants={item}
          aria-label="Audit trail"
          className={cn(cardCls, "mt-6 divide-y divide-slate-100 dark:divide-white/5")}
        >
          {shown.map((event) => {
            const meta = ACTION_META[event.action];
            const Icon = meta.icon;
            return (
              <div
                key={event.id}
                className="flex items-start gap-4 px-4 py-4 transition-colors hover:bg-slate-50/70 sm:px-6 dark:hover:bg-white/[0.03]"
              >
                <span
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                    meta.tile
                  )}
                >
                  <Icon className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-[15.5px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
                      {event.title}
                    </h3>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
                        meta.badge
                      )}
                    >
                      {event.action}
                    </span>
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px] text-slate-500 dark:text-slate-400">
                    <span className="font-medium">{event.actor}</span>
                    <span aria-hidden="true">•</span>
                    <span className="min-w-0 truncate">{event.detail}</span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      |
                    </span>
                    <span className="truncate">{event.email}</span>
                  </p>
                </div>

                <time
                  dateTime={new Date(event.ts).toISOString()}
                  className="shrink-0 whitespace-nowrap pt-1 text-[13px] text-slate-500 dark:text-slate-400"
                >
                  {formatRelative(event.ts)}
                </time>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-center gap-3 px-6 py-4">
            <p className="text-[12.5px] text-slate-400 dark:text-slate-500">
              Showing {shown.length} of {filtered.length} events
            </p>
            {visible < filtered.length && (
              <>
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                >
                  Show more
                  <span className="ml-2 text-[12px] font-medium text-slate-400">
                    {filtered.length - visible} older
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setVisible(filtered.length)}
                  className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold text-purple-600 transition-colors hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:text-purple-300 dark:hover:bg-purple-500/10"
                >
                  Show all
                </button>
              </>
            )}
          </div>
        </motion.section>
      )}
    </motion.div>
  );
}
