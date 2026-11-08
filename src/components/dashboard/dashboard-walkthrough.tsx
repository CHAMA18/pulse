"use client";

import { motion } from "framer-motion";
import {
  BarChart3,
  CheckCircle2,
  Compass,
  Eye,
  History,
  Home,
  LayoutGrid,
  MonitorSmartphone,
  Play,
  RotateCcw,
  Sparkles,
  Store,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WalkthroughStep } from "@/components/walkthrough/walkthrough";

/* ------------------------------------------------------------------ */
/* The Pulse console walkthrough script                                */
/* ------------------------------------------------------------------ */

export const PULSE_TOUR_STEPS: WalkthroughStep[] = [
  {
    id: "pulse-welcome",
    title: "Welcome to the Pulse console",
    body: "A short lap of the network side of Pulse — every pharmacy, every shelf, every action on record. Click anywhere or press Next to walk it.",
  },
  {
    id: "pulse-nav",
    title: "One sidebar, three neighbourhoods",
    body: "Main is the network overview. Admin keeps the record straight. Pulse Network is where pharmacies, stock and suppliers live.",
    target: "pulse-nav",
  },
  {
    id: "pulse-home",
    title: "Home — the network at a glance",
    page: "home",
    target: "pulse-home",
    body: "Inventory value, items sold, goods received and low-stock alerts lead the page; watchlists below surface what needs attention first.",
  },
  {
    id: "pulse-audit",
    title: "Audit Logs — every action on record",
    page: "audit",
    target: "pulse-audit",
    body: "A tamper-resistant activity feed: who did what, where, and when — across both portals of the application.",
  },
  {
    id: "pulse-users",
    title: "User Management — people and roles",
    page: "users",
    target: "pulse-users",
    body: "Pulse accounts, roles and status in one table. Invite administrators and staff; every invitation goes out as a branded email.",
  },
  {
    id: "pulse-pharmacies",
    title: "Pulse Pharmacies — the network roster",
    page: "pharmacies",
    target: "pulse-pharmacies",
    body: "Every pharmacy on the network with its stores and onboarding state. Review new registrations and welcome them in.",
  },
  {
    id: "pulse-stock",
    title: "Stock Balance Visibility — shelves without walls",
    page: "stock",
    target: "pulse-stock",
    body: "See the stock health of every member pharmacy — healthy, low and out of stock — to steer the network's supply.",
  },
  {
    id: "pulse-suppliers",
    title: "Supplier Management — the supply side",
    page: "suppliers",
    target: "pulse-suppliers",
    body: "The wholesalers behind the network: verification, categories and lead times in a single directory.",
  },
  {
    id: "pulse-finish",
    title: "That's the Pulse console",
    body: "Replay this tour any time from Walkthrough in the sidebar. Pharmacies get their own walkthrough inside the Pharmacy portal.",
  },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const CHAPTER_ICONS: Record<string, LucideIcon> = {
  "pulse-nav": Compass,
  "pulse-home": Home,
  "pulse-audit": History,
  "pulse-users": UserCog,
  "pulse-pharmacies": LayoutGrid,
  "pulse-stock": Eye,
  "pulse-suppliers": Store,
};

export function DashboardWalkthrough({
  onGoTo,
  onStartTour,
}: {
  onGoTo: (page: string) => void;
  onStartTour: () => void;
}) {
  const chapters = PULSE_TOUR_STEPS.filter((step) => step.id !== "pulse-welcome" && step.id !== "pulse-finish");

  return (
    <div aria-labelledby="pulse-walkthrough-title">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4" data-tour="pulse-walkthrough">
        <div className="flex items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
            <Compass className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-[21px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
              Walkthrough
            </h2>
            <p className="text-[13.5px] text-slate-500 dark:text-slate-400">
              A guided lap of the Pulse console — it highlights each section as it goes
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onStartTour}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white",
            "shadow-[0_8px_22px_-8px_rgba(147,51,234,0.65)] transition-shadow hover:shadow-[0_12px_28px_-8px_rgba(147,51,234,0.8)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          )}
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          Start the walkthrough
        </button>
      </div>
      <h2 id="pulse-walkthrough-title" className="sr-only">
        Walkthrough
      </h2>

      {/* Hero */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
        className={cn(
          "mt-5 overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10",
          "bg-[linear-gradient(135deg,#f5f0ff_0%,#fdf4ff_55%,#ffffff_100%)] dark:bg-[linear-gradient(135deg,#1d1033_0%,#221033_55%,#150b2b_100%)]"
        )}
      >
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white shadow-[0_14px_30px_-10px_rgba(147,51,234,0.7)]">
            <MonitorSmartphone className="h-7 w-7" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-purple-600 dark:text-purple-300">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Interactive · {PULSE_TOUR_STEPS.length} steps · about 2 minutes
            </p>
            <h3 className="mt-1.5 text-[19px] font-bold leading-snug tracking-tight text-slate-900 dark:text-white">
              See the whole network without leaving your seat
            </h3>
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              The tour moves through the real console — the overview, the audit trail, the people,
              the pharmacies, their stock and the suppliers — spotlighting exactly the section being
              discussed and dimming everything else.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <button
              type="button"
              onClick={onStartTour}
              className={cn(
                "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-5 text-[14px] font-semibold text-white",
                "shadow-[0_10px_26px_-8px_rgba(147,51,234,0.75)] transition-shadow hover:shadow-[0_14px_32px_-8px_rgba(147,51,234,0.9)]"
              )}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Start walkthrough
            </button>
            <button
              type="button"
              onClick={() => onGoTo("home")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-4 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-white dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Replay later
            </button>
          </div>
        </div>
      </motion.div>

      {/* Chapters */}
      <div className="mt-7">
        <h3 className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
          What the tour covers
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {chapters.map((chapter, index) => {
            const Icon = CHAPTER_ICONS[chapter.id] ?? Compass;
            return (
              <motion.button
                key={chapter.id}
                type="button"
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                onClick={onStartTour}
                className={cn(
                  "group flex flex-col items-start rounded-2xl bg-white p-4 text-left shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] transition-shadow hover:shadow-[0_16px_36px_-16px_rgba(88,28,135,0.35)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10"
                )}
              >
                <div className="flex w-full items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600 transition-colors group-hover:bg-purple-600 group-hover:text-white dark:bg-purple-500/15 dark:text-purple-400">
                    <Icon className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
                  </span>
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                    Chapter {index + 1}
                  </p>
                  <Play className="ml-auto h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-500" aria-hidden="true" />
                </div>
                <p className="mt-2.5 text-[14px] font-bold leading-snug text-slate-900 dark:text-white">
                  {chapter.title}
                </p>
                <p className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {chapter.body}
                </p>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Cross-portal note */}
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-white px-4 py-3.5 text-[13px] shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
        <p className="text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-white">Also on the other side:</span>{" "}
          the Pharmacy portal carries its own comprehensive walkthrough — open{" "}
          <span className="font-semibold">Walkthrough</span> in its sidebar after signing in there.
        </p>
      </div>
    </div>
  );
}
