"use client";

import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Compass,
  LayoutDashboard,
  MonitorSmartphone,
  Package,
  Play,
  RotateCcw,
  Settings,
  ShoppingCart,
  Sparkles,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import { PageHeader, pharmacyCardCls } from "@/components/pharmacy/pharmacy-shared";
import { cn } from "@/lib/utils";
import type { WalkthroughStep } from "@/components/walkthrough/walkthrough";

/* ------------------------------------------------------------------ */
/* The Pharmacy portal walkthrough script                              */
/* ------------------------------------------------------------------ */
/* One chapter per corner of the console. The tour navigates the real  */
/* pages and spotlights each section as it goes.                       */

export const PHARMACY_TOUR_STEPS: WalkthroughStep[] = [
  {
    id: "ph-welcome",
    title: "Welcome to your pharmacy console",
    body: "A three-minute lap of everything Pulse gives your pharmacy — the counter, the shelves, the stock room and the team. Click anywhere or press Next to walk it.",
  },
  {
    id: "ph-nav",
    title: "One sidebar, five neighbourhoods",
    body: "Main is your day (dashboard, counter and shift till). Operations runs stock end-to-end. Learn holds the guided tour. Administration keeps stores and people. Account is yours.",
    target: "ph-nav",
  },
  {
    id: "ph-home",
    title: "Dashboard — today at a glance",
    page: "home",
    target: "ph-home",
    body: "Sales, stock value and what needs attention surface here first, so the morning check takes seconds.",
  },
  {
    id: "ph-pos",
    title: "Point of Sale — a sale in under two minutes",
    page: "pos",
    target: "ph-pos",
    body: "Tap products onto the receipt, take cash, mobile or card, and the shelf drops automatically. Fast enough for the queue at lunch.",
  },
  {
    id: "ph-shifts",
    title: "Shift Management — balance the till before handover",
    page: "shifts",
    target: "ph-shifts",
    body: "Open the till with its starting float, ring up sales, then count the cash at close. Pulse compares cash at hand with the system total, records any variance and closes the shift before the next cashier takes over.",
  },
  {
    id: "ph-balance",
    title: "Stock Balance — what you hold, what it's worth",
    page: "balance",
    target: "ph-balance",
    body: "Category value bars, expiry watch and per-store health. This is the page for the weekly ordering decision.",
  },
  {
    id: "ph-inventory",
    title: "Inventory — your product catalogue",
    page: "inventory",
    target: "ph-inventory",
    body: "One stop for the master product list — add or import products, set packs, shelf prices, prescription flags and low-stock triggers. Stock Balance shows what is on hand, and quantities change under Stock Movement.",
  },
  {
    id: "ph-movement",
    title: "Stock Movement — the only place quantities change",
    page: "movement",
    target: "ph-movement",
    body: "Receipts, issues, transfers between stores and count corrections — each with a reason, each leaving an auditable trail.",
  },
  {
    id: "ph-requests",
    title: "Stock Requests — replenishment with a paper trail",
    page: "requests",
    target: "ph-requests",
    body: "One page for both queues: request stock from the hub, or raise a purchase order to a supplier — follow each from draft to delivered.",
  },
  {
    id: "ph-stores",
    title: "Stores — many branches, one declared main",
    page: "stores",
    target: "ph-stores",
    body: "Add as many storefronts as you trade from and declare which one is the account's main store — the application's home.",
  },
  {
    id: "ph-users",
    title: "User Management — invite your team by email",
    page: "users",
    target: "ph-users",
    body: "Invite pharmacists, cashiers and managers with a beautifully branded email, scoped store access and a role that decides what they see.",
  },
  {
    id: "ph-settings",
    title: "Settings — make it yours",
    page: "settings",
    target: "ph-settings",
    body: "Notification preferences and sign-out live here. Your preferences stay on this device.",
  },
  {
    id: "ph-finish",
    title: "You're ready to trade",
    body: "That's the lap! Open Walkthrough in the sidebar any time to replay this tour, and find Quick Access at the bottom of the sidebar for the everyday shortcuts.",
  },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const CHAPTER_ICONS: Record<string, typeof Compass> = {
  "ph-nav": Compass,
  "ph-home": LayoutDashboard,
  "ph-pos": ShoppingCart,
  "ph-shifts": Wallet,
  "ph-balance": Boxes,
  "ph-inventory": Package,
  "ph-movement": ArrowLeftRight,
  "ph-requests": ClipboardList,
  "ph-stores": Warehouse,
  "ph-users": Users,
  "ph-settings": Settings,
};

export function PharmacyWalkthrough({
  steps,
  onGoTo,
  onStartTour,
}: {
  /** Tour steps this role is allowed to visit. */
  steps: WalkthroughStep[];
  onGoTo: (page: string) => void;
  onStartTour: () => void;
}) {
  const chapters = steps.filter((step) => step.id !== "ph-welcome" && step.id !== "ph-finish");

  return (
    <div aria-labelledby="pharmacy-walkthrough-title">
      <PageHeader
        icon={Compass}
        title="Walkthrough"
        subtitle="A guided lap of the whole Pharmacy portal — it highlights each section as it goes"
        tourId="ph-walkthrough"
        actions={
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
        }
      />
      <h2 id="pharmacy-walkthrough-title" className="sr-only">
        Walkthrough
      </h2>

      {/* Hero */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
        className={cn(
          pharmacyCardCls,
          "mt-5 overflow-hidden bg-[linear-gradient(135deg,#f5f0ff_0%,#fdf4ff_55%,#ffffff_100%)] dark:bg-[linear-gradient(135deg,#1d1033_0%,#221033_55%,#150b2b_100%)]"
        )}
      >
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white shadow-[0_14px_30px_-10px_rgba(147,51,234,0.7)]">
            <MonitorSmartphone className="h-7 w-7" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-purple-600 dark:text-purple-300">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Interactive · {steps.length} steps · about 3 minutes
            </p>
            <h3 className="mt-1.5 text-[19px] font-bold leading-snug tracking-tight text-slate-900 dark:text-white">
              Learn every corner of the console — only the section being discussed is lit up
            </h3>
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              The walkthrough walks the real pages: the counter, the shelves, the movement ledger
              and the team. Wherever you are, the relevant section is spotlighted and
              everything else dims — you always know exactly what to look at.
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
                onClick={() => onStartTour()}
                className={cn(
                  pharmacyCardCls,
                  "group flex flex-col items-start p-4 text-left transition-shadow hover:shadow-[0_16px_36px_-16px_rgba(88,28,135,0.35)]"
                )}
              >
                <div className="flex w-full items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600 transition-colors group-hover:bg-purple-600 group-hover:text-white dark:bg-purple-500/15 dark:text-purple-400">
                    <Icon className="h-4.5 w-4.5" strokeWidth={2.1} aria-hidden="true" />
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
      <div className={cn(pharmacyCardCls, "mt-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5 text-[13px]")}>
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
        <p className="text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-white">Also on the other side:</span>{" "}
          the Pulse console carries its own comprehensive walkthrough — sign in through the Pulse
          portal and open <span className="font-semibold">Walkthrough</span> in its sidebar.
        </p>
      </div>
    </div>
  );
}
