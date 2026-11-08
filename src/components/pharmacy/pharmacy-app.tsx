"use client";

import { motion, MotionConfig } from "framer-motion";
import {
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Pill,
  Search,
  Settings,
  ShoppingBag,
  Store,
  TriangleAlert,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PharmacyDeliveries } from "@/components/pharmacy/pharmacy-deliveries";
import { PharmacyInventory } from "@/components/pharmacy/pharmacy-inventory";
import { PharmacyProfile } from "@/components/pharmacy/pharmacy-profile";
import { PharmacyStockRequests } from "@/components/pharmacy/pharmacy-stock-requests";
import {
  formatDay,
  formatZMW,
  loadDeliveries,
  loadInventory,
  loadStockRequests,
  type Delivery,
  type InventoryItem,
  type StockRequest,
} from "@/components/pharmacy/pharmacy-data";
import {
  PHARMACY_WORKSPACE,
  pharmacyCardCls,
  StatusPill,
} from "@/components/pharmacy/pharmacy-shared";
import { recordAudit } from "@/lib/audit-log";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { clearStoredPortal, getStoredPortal } from "@/lib/portal";
import {
  getFirebaseAuth,
  getPharmacyRegistrations,
  isAdminUser,
  trackEvent,
} from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Navigation model                                                    */
/* ------------------------------------------------------------------ */

type PharmacyPage = "home" | "inventory" | "requests" | "deliveries" | "profile";

/** Compact page titles used in the audit trail ("Viewed PharmacyInventory"). */
const PAGE_AUDIT_TITLES: Record<PharmacyPage, string> = {
  home: "PharmacyDashboard",
  inventory: "PharmacyInventory",
  requests: "StockRequests",
  deliveries: "Deliveries",
  profile: "MyPharmacy",
};

const NAV_SECTIONS: { section: string; items: { label: string; icon: LucideIcon }[] }[] = [
  { section: "Main", items: [{ label: "Dashboard", icon: LayoutDashboard }] },
  {
    section: "Operations",
    items: [
      { label: "Inventory", icon: Package },
      { label: "Stock Requests", icon: ClipboardList },
      { label: "Deliveries", icon: Truck },
    ],
  },
  { section: "Network", items: [{ label: "Supplier Directory", icon: Store }] },
  {
    section: "Account",
    items: [
      { label: "My Pharmacy", icon: Building2 },
      { label: "Settings", icon: Settings },
    ],
  },
];

/** Which sidebar entries are live pages vs. "coming soon" stubs. */
const LIVE_PAGES: Record<string, PharmacyPage> = {
  Dashboard: "home",
  Inventory: "inventory",
  "Stock Requests": "requests",
  Deliveries: "deliveries",
  "My Pharmacy": "profile",
};

const QUICK_ACTIONS = ["Request stock", "Adjust stock", "Record delivery"];

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  },
};

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function PharmacySidebar({
  collapsed,
  dark,
  onDarkChange,
  onCollapsedChange,
  onNavClick,
  onQuickAction,
  onClose,
  user,
  page,
}: {
  collapsed: boolean;
  dark: boolean;
  onDarkChange: (on: boolean) => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  onNavClick: (label: string) => void;
  onQuickAction: (action?: string) => void;
  onClose?: () => void;
  user: { name: string; email: string; initial: string };
  page: PharmacyPage;
}) {
  const [quickOpen, setQuickOpen] = useState(false);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#08130e]">
      {/* Brand — the Pharmacy portal wears its own mark, not the Pulse logo */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-slate-100 dark:border-white/5",
          collapsed ? "justify-center px-0" : "gap-2.5 px-5"
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-[0_6px_16px_-6px_rgba(16,185,129,0.8)]"
          )}
        >
          <Pill className="h-5 w-5 text-white" strokeWidth={2.2} aria-hidden="true" />
        </span>
        {!collapsed && (
          <span className="select-none text-[16.5px] font-bold tracking-tight text-slate-900 dark:text-white">
            Pharmacy Portal
          </span>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Signed-in user */}
      <div className={cn("shrink-0 p-3", collapsed && "px-2")}>
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-white/5",
            collapsed ? "justify-center p-2" : "p-3"
          )}
          title={collapsed ? user.name : undefined}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[15px] font-bold text-white">
            {user.initial}
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">
                {user.name}
              </p>
              <span className="mt-0.5 inline-block rounded-full bg-emerald-100 px-2 py-px text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                Owner
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="pulse-scroll flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
        {NAV_SECTIONS.map(({ section, items }) => (
          <div key={section} className="mt-4 first:mt-1">
            {!collapsed ? (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                {section}
              </p>
            ) : (
              <div className="mx-auto my-3 h-px w-8 bg-slate-100 dark:bg-white/10" />
            )}
            <div className="flex flex-col gap-0.5">
              {items.map(({ label, icon: Icon }) => {
                const active = LIVE_PAGES[label] === page;
                return (
                  <button
                    key={label}
                    type="button"
                    title={collapsed ? label : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onNavClick(label)}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500",
                      collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
                      active
                        ? "bg-emerald-100/90 text-slate-900 dark:bg-emerald-500/20 dark:text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition-colors",
                        active
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300"
                      )}
                      strokeWidth={2.1}
                      aria-hidden="true"
                    />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom controls */}
      <div className="shrink-0 border-t border-slate-100 p-3 dark:border-white/5">
        {/* Dark mode — split layouts keep <button> elements from nesting
            (Radix Switch renders its own <button>) */}
        {collapsed ? (
          <button
            type="button"
            onClick={() => onDarkChange(!dark)}
            aria-pressed={dark}
            title="Toggle dark mode"
            className="flex w-full items-center justify-center rounded-lg py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
          >
            <Moon
              className={cn(
                "h-[18px] w-[18px] shrink-0",
                dark ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <div className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Moon
              className={cn(
                "h-[18px] w-[18px] shrink-0",
                dark ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
              )}
              aria-hidden="true"
            />
            <span>Dark Mode</span>
            <Switch
              checked={dark}
              onCheckedChange={onDarkChange}
              aria-label="Toggle dark mode"
              className="ml-auto"
            />
          </div>
        )}

        {/* Quick access */}
        <div>
          <button
            type="button"
            onClick={() => (collapsed ? onQuickAction() : setQuickOpen((v) => !v))}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5",
              collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2"
            )}
            aria-expanded={quickOpen}
            title={collapsed ? "Quick Access" : undefined}
          >
            <LayoutDashboard className="h-[18px] w-[18px] shrink-0 text-slate-400" aria-hidden="true" />
            {!collapsed && (
              <>
                <span>Quick Access</span>
                <ChevronDown
                  className={cn(
                    "ml-auto h-4 w-4 text-slate-400 transition-transform duration-200",
                    quickOpen && "rotate-180"
                  )}
                  aria-hidden="true"
                />
              </>
            )}
          </button>
          {quickOpen && !collapsed && (
            <div className="mb-1 ml-9 mt-0.5 flex flex-col gap-0.5 rounded-lg bg-slate-50 p-1.5 dark:bg-white/5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => onQuickAction(action)}
                  className="rounded-md px-2.5 py-1.5 text-left text-[13px] text-slate-600 transition-all hover:bg-white hover:text-slate-900 hover:shadow-sm dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  {action}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Collapse (desktop only) */}
        {onCollapsedChange && (
          <button
            type="button"
            onClick={() => onCollapsedChange(!collapsed)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-white/5",
              collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2"
            )}
            aria-pressed={collapsed}
            title={collapsed ? "Expand" : undefined}
          >
            {collapsed ? (
              <ChevronsRight className="h-[18px] w-[18px] shrink-0 text-slate-400" aria-hidden="true" />
            ) : (
              <>
                <ChevronsLeft className="h-[18px] w-[18px] shrink-0 text-slate-400" aria-hidden="true" />
                <span>Collapse</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Home page                                                           */
/* ------------------------------------------------------------------ */

function PharmacyHome({
  user,
  pharmacyName,
  pendingReview,
  onGoTo,
}: {
  user: { name: string; initial: string };
  pharmacyName: string;
  pendingReview: boolean;
  onGoTo: (page: PharmacyPage) => void;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setItems(loadInventory());
      setRequests(loadStockRequests());
      setDeliveries(loadDeliveries());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const skuCount = items.length;
  const units = items.reduce((acc, entry) => acc + entry.qty, 0);
  const value = items.reduce((acc, entry) => acc + entry.qty * entry.unitPrice, 0);
  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const attentionItems = items.filter((entry) => entry.qty <= entry.reorderLevel);

  const STAT_CARDS: {
    id: string;
    value: string;
    label: string;
    desc: string;
    icon: LucideIcon;
    tile: string;
  }[] = [
    {
      id: "stock-on-hand",
      value: String(hydrated ? skuCount : "—"),
      label: "Stock on Hand",
      desc: `${hydrated ? units : "—"} units · ${hydrated ? formatZMW(value) : "—"} value`,
      icon: ShoppingBag,
      tile: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
    },
    {
      id: "items-sold",
      value: "128",
      label: "Items Sold",
      desc: "Sell-through captured from POS",
      icon: Package,
      tile: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
    },
    {
      id: "pending-requests",
      value: String(hydrated ? pendingCount : "—"),
      label: "Pending Requests",
      desc: "Awaiting Pulse hub approval",
      icon: ClipboardList,
      tile: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
    },
    {
      id: "low-stock",
      value: String(hydrated ? attentionItems.length : "—"),
      label: "Low Stock Alerts",
      desc: "Items approaching reorder levels",
      icon: TriangleAlert,
      tile: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
    },
  ];

  // Requests + deliveries merged into one recent-activity feed.
  const activity = [
    ...requests.map((r) => ({
      kind: "REQUEST" as const,
      title: `${r.id} · ${r.item} × ${r.qty}`,
      when: r.submittedAt,
    })),
    ...deliveries.map((d) => ({
      kind: "DELIVERY" as const,
      title: `${d.id} · ${d.supplier}`,
      when: d.receivedAt,
    })),
  ]
    .sort((a, b) => b.when - a.when)
    .slice(0, 4);

  return (
    <>
      {/* Greeting hero — the Pharmacy portal's signature card */}
      <motion.section
        variants={item}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-500 px-6 py-7 shadow-[0_20px_50px_-20px_rgba(16,185,129,0.55)] sm:px-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-2xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[13.5px] font-medium text-emerald-50/90">
              {greeting}, {user.name.split(" ")[0]} 👋
            </p>
            <h1 className="mt-1.5 text-[24px] font-bold leading-tight tracking-tight text-white sm:text-[26px]">
              {pharmacyName}
            </h1>
            <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-emerald-50/90">
              Your pharmacy at a glance — stock, requests and deliveries in one place.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2.5">
            {pendingReview ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-300/90 px-3 py-1.5 text-[12px] font-semibold text-amber-950">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                Pending network review
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-[12px] font-semibold text-white">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Active
              </span>
            )}
            <button
              type="button"
              onClick={() => onGoTo("requests")}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-4 text-[13.5px] font-semibold text-emerald-700 shadow-[0_8px_20px_-8px_rgba(6,78,59,0.5)] transition-colors hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <ClipboardList className="h-4 w-4" aria-hidden="true" />
              Request stock
            </button>
          </div>
        </div>
      </motion.section>

      {/* Onboarding callout for freshly registered pharmacies */}
      {pendingReview && (
        <motion.div
          variants={item}
          className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-500/20 dark:bg-amber-500/10"
        >
          <TriangleAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-amber-900 dark:text-amber-200">
            Your registration is with the Pulse network team for review — usually done within two
            business days. You can keep stocking and requesting in the meantime.
          </p>
          <button
            type="button"
            onClick={() => onGoTo("profile")}
            className="inline-flex h-9 shrink-0 items-center rounded-md border border-amber-300 bg-white px-3.5 text-[13px] font-semibold text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:border-amber-500/30 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-500/10"
          >
            View My Pharmacy
          </button>
        </motion.div>
      )}

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-4">
        {STAT_CARDS.map(({ id, value, label, desc, icon: Icon, tile }) => (
          <motion.div key={id} variants={item} className={cn(pharmacyCardCls, "flex items-center gap-4 p-5")}>
            <span
              className={cn(
                "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl",
                tile
              )}
            >
              <Icon className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="whitespace-nowrap text-2xl font-bold leading-none tracking-tight">{value}</p>
              <p className="mt-2 whitespace-nowrap text-[15px] font-semibold leading-none">{label}</p>
              <p className="mt-1.5 text-[13px] leading-snug text-slate-500 dark:text-slate-400">
                {desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Inventory health — live from the pharmacy's own shelves */}
      <motion.section variants={item} className="mt-9" aria-labelledby="pharmacy-inventory-health">
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <Package className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div>
            <h2
              id="pharmacy-inventory-health"
              className="text-[21px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white"
            >
              Inventory Health
            </h2>
            <p className="text-[13.5px] text-slate-500 dark:text-slate-400">
              Items at or below their reorder level
            </p>
          </div>
        </div>
        <div className={cn(pharmacyCardCls, "mt-4 divide-y divide-slate-100 dark:divide-white/5")}>
          {attentionItems.length === 0 ? (
            <div className="flex min-h-[64px] items-center justify-center gap-2 px-4 py-5 text-[13.5px] text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
              All shelves are healthy — nothing needs attention right now.
            </div>
          ) : (
            attentionItems.slice(0, 5).map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-slate-900 dark:text-white">
                    {entry.name}
                  </p>
                  <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
                    {entry.category} · reorder at {entry.reorderLevel}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-3">
                  <span className="text-[14px] font-bold tabular-nums">{entry.qty}</span>
                  <StatusPill status={entry.qty === 0 ? "out" : "low"} label={entry.qty === 0 ? "Out of stock" : "Low"} />
                </div>
              </div>
            ))
          )}
        </div>
      </motion.section>

      {/* Recent activity — requests and deliveries in one feed */}
      <motion.section variants={item} className="mt-9" aria-labelledby="pharmacy-activity">
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <Truck className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div>
            <h2
              id="pharmacy-activity"
              className="text-[21px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white"
            >
              Recent Activity
            </h2>
            <p className="text-[13.5px] text-slate-500 dark:text-slate-400">
              Stock requests and goods received
            </p>
          </div>
        </div>
        <div className={cn(pharmacyCardCls, "mt-4 p-5")}>
          <ul className="flex flex-col gap-4">
            {activity.map(({ kind, title, when }) => (
              <li key={`${kind}-${title}-${when}`} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    kind === "REQUEST"
                      ? "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                      : "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                  )}
                >
                  {kind === "REQUEST" ? (
                    <ClipboardList className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                  ) : (
                    <Truck className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold tracking-wide">{kind}</p>
                  <p className="truncate text-[13px] text-slate-500 dark:text-slate-400">{title}</p>
                </div>
                <time className="ml-auto shrink-0 whitespace-nowrap text-[13px] text-slate-500 dark:text-slate-400">
                  {formatDay(when)}
                </time>
              </li>
            ))}
          </ul>
        </div>
      </motion.section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pharmacy portal app shell                                           */
/* ------------------------------------------------------------------ */

export function PharmacyApp() {
  const { toast } = useToast();
  const router = useRouter();

  const [dark, setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [page, setPage] = useState<PharmacyPage>("home");
  const [user, setUser] = useState({ name: "Pharmacy Owner", email: "", initial: "P" });
  const [pharmacyName, setPharmacyName] = useState("My Pharmacy");
  const [pendingReview, setPendingReview] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [bouncing, setBouncing] = useState(false);

  // Resolve the session: pharmacy-portal sessions stay; Pulse-portal sessions
  // without elevated rights are bounced back to the Pulse console.
  useEffect(() => {
    let active = true;

    void (async () => {
      const auth = getFirebaseAuth();
      try {
        await auth?.authStateReady();
      } catch {
        /* fall through — read whatever identity is available */
      }
      if (!active) return;

      const current = auth?.currentUser;
      if (getStoredPortal() === "pulse" && current && !(await isAdminUser(current))) {
        // This session belongs to the Pulse console.
        if (active) {
          setBouncing(true);
          router.replace("/dashboard");
        }
        return;
      }

      const name = current?.displayName ?? current?.email?.split("@")[0] ?? "Pharmacy Owner";
      const email = current?.email ?? "";
      const registration = current
        ? getPharmacyRegistrations().find(
            (r) => r.uid === current.uid || (email && r.email === email.toLowerCase())
          )
        : undefined;
      if (active) {
        setUser({
          name,
          email,
          initial: (name[0] ?? "P").toUpperCase(),
        });
        setPharmacyName(registration?.pharmacyName ?? name);
        setPendingReview(Boolean(registration));
        setResolved(true);
      }
    })();

    const prefersDark = window.localStorage.getItem("pulse-theme") === "dark";
    document.documentElement.classList.toggle("dark", prefersDark);
    const raf = requestAnimationFrame(() => {
      if (active) setDark(prefersDark);
    });

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("dark");
    };
  }, [router]);

  useEffect(() => {
    if (bouncing) return;
    void trackEvent("pharmacy_dashboard_view");
  }, [bouncing]);

  // Every visited page leaves a "Viewed <Page>" entry in the audit trail.
  useEffect(() => {
    if (bouncing || !user.email) return;
    recordAudit({
      title: `Viewed ${PAGE_AUDIT_TITLES[page]}`,
      action: "View",
      detail: PHARMACY_WORKSPACE,
      actor: user.name,
      email: user.email,
    });
  }, [page, user.email, user.name, bouncing]);

  const toggleDark = (on: boolean) => {
    setDark(on);
    document.documentElement.classList.toggle("dark", on);
    window.localStorage.setItem("pulse-theme", on ? "dark" : "light");
  };

  const goTo = (target: PharmacyPage) => {
    setPage(target);
  };

  const onNavClick = (label: string) => {
    setMobileOpen(false);
    const target = LIVE_PAGES[label];
    if (target && target !== page) {
      goTo(target);
      if (user.email) {
        recordAudit({
          title: "SidebarLink Navigate To",
          action: "View",
          detail: PHARMACY_WORKSPACE,
          actor: user.name,
          email: user.email,
        });
      }
      void trackEvent("pharmacy_nav_click", { page: target });
      return;
    }
    if (target) return; // already on that page
    toast({
      title: `${label} is coming soon`,
      description: "This area of the Pharmacy portal is on its way.",
    });
  };

  const onQuickAction = (action?: string) => {
    if (action === "Request stock") {
      setMobileOpen(false);
      goTo("requests");
      return;
    }
    if (action === "Adjust stock") {
      setMobileOpen(false);
      goTo("inventory");
      return;
    }
    if (action === "Record delivery") {
      setMobileOpen(false);
      goTo("deliveries");
      return;
    }
    toast({
      title: `${action ?? "Quick access"} is coming soon`,
      description: "Shortcuts land here as the portal grows.",
    });
  };

  const onSignOut = async () => {
    const auth = getFirebaseAuth();
    if (auth) {
      try {
        await signOut(auth);
      } catch {
        /* signing out locally regardless */
      }
    }
    clearStoredPortal();
    void trackEvent("logout", { portal: "pharmacy" });
    toast({ title: "Signed out", description: "See you soon!" });
    router.replace("/");
  };

  const sidebar = (extra: { collapsed: boolean; onCollapsedChange?: (c: boolean) => void; onClose?: () => void }) => (
    <PharmacySidebar
      collapsed={extra.collapsed}
      dark={dark}
      onDarkChange={toggleDark}
      onCollapsedChange={extra.onCollapsedChange}
      onNavClick={onNavClick}
      onQuickAction={onQuickAction}
      onClose={extra.onClose}
      user={user}
      page={page}
    />
  );

  // While the session is being resolved (or bounced to the Pulse console),
  // hold the branded splash — never flash the wrong portal's console.
  if (!resolved || bouncing) {
    return (
      <div
        className="pulse-space flex min-h-dvh flex-col items-center justify-center gap-5"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="flex h-14 w-14 animate-float items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-[0_0_24px_rgba(16,185,129,0.45)]">
          <Pill className="h-7 w-7 text-white" aria-hidden="true" />
        </span>
        <p className="flex items-center gap-2.5 text-sm text-white/70">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
          {bouncing ? "Taking you to the Pulse console…" : "Preparing your pharmacy workspace…"}
        </p>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh bg-[#f4f7f5] text-slate-900 dark:bg-[#050f0b] dark:text-white">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 border-r border-slate-200/70 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block dark:border-white/10",
            collapsed ? "w-[76px]" : "w-[272px]"
          )}
        >
          {sidebar({ collapsed, onCollapsedChange: setCollapsed })}
        </aside>

        {/* Mobile sidebar */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
            />
            <aside className="absolute inset-y-0 left-0 w-[272px] shadow-2xl">
              {sidebar({ collapsed: false, onClose: () => setMobileOpen(false) })}
            </aside>
          </div>
        )}

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white/85 px-4 backdrop-blur-md sm:px-6 dark:border-white/10 dark:bg-[#071711]/85">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-white/10"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="ml-auto flex items-center gap-2.5">
              <button
                type="button"
                aria-label="Search"
                onClick={() => toast({ title: "Search", description: "Search is coming soon." })}
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 dark:text-slate-400 dark:hover:bg-white/10"
              >
                <Search className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                aria-label="Notifications"
                onClick={() =>
                  toast({ title: "You're all caught up", description: "No new notifications." })
                }
                className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100/70 text-emerald-600 transition-colors hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-400 dark:hover:bg-emerald-500/25"
              >
                <Bell className="h-[18px] w-[18px]" />
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[15px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(16,185,129,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                  >
                    {user.initial}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{user.name}</p>
                    <p className="truncate text-xs font-normal text-slate-500 dark:text-slate-400">
                      {user.email || "Signed in"}
                    </p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onSignOut}
                    className="text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-300"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <motion.main
            key={page}
            variants={container}
            initial="hidden"
            animate="show"
            className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8"
          >
            {page === "inventory" ? (
              <PharmacyInventory />
            ) : page === "requests" ? (
              <PharmacyStockRequests />
            ) : page === "deliveries" ? (
              <PharmacyDeliveries />
            ) : page === "profile" ? (
              <PharmacyProfile user={user} />
            ) : (
              <PharmacyHome
                user={user}
                pharmacyName={pharmacyName}
                pendingReview={pendingReview}
                onGoTo={goTo}
              />
            )}
          </motion.main>
        </div>
      </div>
    </MotionConfig>
  );
}
