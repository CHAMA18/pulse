"use client";

import { motion, MotionConfig } from "framer-motion";
import {
  Bell,
  Boxes,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  PackageSearch,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  TriangleAlert,
  Truck,
  Users,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PulseMark } from "@/components/login/pulse-logo";
import { PharmacyCatalogue } from "@/components/pharmacy/pharmacy-catalogue";
import { PharmacyDeliveries } from "@/components/pharmacy/pharmacy-deliveries";
import { PharmacyInventory } from "@/components/pharmacy/pharmacy-inventory";
import { PharmacyPOS } from "@/components/pharmacy/pharmacy-pos";
import { PharmacyProfile } from "@/components/pharmacy/pharmacy-profile";
import { PharmacyPurchaseOrders } from "@/components/pharmacy/pharmacy-purchase-orders";
import { PharmacySettings } from "@/components/pharmacy/pharmacy-settings";
import { PharmacyStockBalance } from "@/components/pharmacy/pharmacy-stock-balance";
import { PharmacyStockRequests } from "@/components/pharmacy/pharmacy-stock-requests";
import { PharmacyStores } from "@/components/pharmacy/pharmacy-stores";
import { PharmacySuppliers } from "@/components/pharmacy/pharmacy-suppliers";
import { PharmacyUserManagement } from "@/components/pharmacy/pharmacy-user-management";
import {
  formatDay,
  formatZMW,
  loadDeliveries,
  loadInventory,
  loadSales,
  loadStockRequests,
  loadStores,
  resolveStoreId,
  saveStores,
  type Delivery,
  type InventoryItem,
  type PharmacyStore,
  type POSSale,
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

type PharmacyPage =
  | "home"
  | "pos"
  | "balance"
  | "inventory"
  | "catalogue"
  | "orders"
  | "requests"
  | "deliveries"
  | "suppliers"
  | "stores"
  | "users"
  | "profile"
  | "settings";

/** Compact page titles used in the audit trail ("Viewed PharmacyInventory"). */
const PAGE_AUDIT_TITLES: Record<PharmacyPage, string> = {
  home: "PharmacyDashboard",
  pos: "PointOfSale",
  balance: "PharmacyStockBalance",
  inventory: "PharmacyInventory",
  catalogue: "ProductCatalogue",
  orders: "PurchaseOrders",
  requests: "StockRequests",
  deliveries: "Deliveries",
  suppliers: "SupplierDirectory",
  stores: "PharmacyStores",
  users: "PharmacyUserManagement",
  profile: "MyPharmacy",
  settings: "PharmacySettings",
};

const NAV_SECTIONS: { section: string; items: { label: string; icon: LucideIcon }[] }[] = [
  {
    section: "Main",
    items: [
      { label: "Dashboard", icon: LayoutDashboard },
      { label: "Point of Sale", icon: ShoppingCart },
    ],
  },
  {
    section: "Operations",
    items: [
      { label: "Stock Balance", icon: Boxes },
      { label: "Inventory", icon: Package },
      { label: "Product Catalogue", icon: PackageSearch },
      { label: "Purchase Orders", icon: ClipboardCheck },
      { label: "Stock Requests", icon: ClipboardList },
      { label: "Deliveries", icon: Truck },
    ],
  },
  { section: "Network", items: [{ label: "Supplier Directory", icon: Store }] },
  {
    section: "Administration",
    items: [
      { label: "Stores", icon: Warehouse },
      { label: "User Management", icon: Users },
    ],
  },
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
  "Point of Sale": "pos",
  "Stock Balance": "balance",
  Inventory: "inventory",
  "Product Catalogue": "catalogue",
  "Purchase Orders": "orders",
  "Stock Requests": "requests",
  Deliveries: "deliveries",
  "Supplier Directory": "suppliers",
  Stores: "stores",
  "User Management": "users",
  "My Pharmacy": "profile",
  Settings: "settings",
};

const QUICK_ACTIONS = ["New sale", "Request stock", "Adjust stock", "Record delivery"];

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
  stores,
  activeStore,
  onStoreChange,
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
  stores: PharmacyStore[];
  activeStore: string;
  onStoreChange: (storeId: string) => void;
}) {
  const [quickOpen, setQuickOpen] = useState(false);

  const activeStoreName =
    activeStore === "all"
      ? "All stores"
      : stores.find((store) => store.id === activeStore)?.name ?? "All stores";

  const storeSwitcher = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Store view — ${activeStoreName}`}
          title={collapsed ? `Store view — ${activeStoreName}` : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl bg-slate-50 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:bg-white/5 dark:hover:bg-white/10",
            collapsed ? "justify-center p-2" : "p-2.5"
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
            <Store className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] font-semibold leading-tight text-slate-900 dark:text-white">
                {activeStoreName}
              </span>
              <span className="block truncate text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                Store view
              </span>
            </span>
          )}
          {!collapsed && (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Store view</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onStoreChange("all")} className="gap-2">
          <Boxes className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span>All stores</span>
          {activeStore === "all" && (
            <Check className="ml-auto h-4 w-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
          )}
        </DropdownMenuItem>
        {stores.map((store) => (
          <DropdownMenuItem
            key={store.id}
            onClick={() => onStoreChange(store.id)}
            className="gap-2"
          >
            <Store className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="min-w-0 truncate">{store.name}</span>
            {activeStore === store.id ? (
              <Check className="ml-auto h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400" aria-hidden="true" />
            ) : store.isMain ? (
              <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-400">
                Main
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#100823]">
      {/* Brand — the Pulse logo crowns the sidebar */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-slate-100 dark:border-white/5",
          collapsed ? "justify-center px-0" : "gap-3 px-5"
        )}
      >
        <PulseMark className="h-9 w-9 shrink-0" />
        {!collapsed && (
          <span className="min-w-0 leading-tight">
            <span className="text-brand-gradient block select-none text-[19px] font-bold leading-none tracking-tight">
              Pulse
            </span>
            <span className="mt-1 block select-none text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Pharmacy Portal
            </span>
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
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 text-[15px] font-bold text-white">
            {user.initial}
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">
                {user.name}
              </p>
              <span className="mt-0.5 inline-block rounded-full bg-purple-100 px-2 py-px text-[11px] font-semibold text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                Owner
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Store view — scope the console to one storefront or the whole account */}
      <div className={cn("shrink-0", collapsed ? "px-2 pb-1" : "px-3 pb-1")}>{storeSwitcher}</div>

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
                      "group flex items-center gap-3 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                      collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
                      active
                        ? "bg-purple-100/90 text-slate-900 dark:bg-purple-500/20 dark:text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition-colors",
                        active
                          ? "text-purple-600 dark:text-purple-400"
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
                dark ? "text-purple-600 dark:text-purple-400" : "text-slate-400"
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <div className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Moon
              className={cn(
                "h-[18px] w-[18px] shrink-0",
                dark ? "text-purple-600 dark:text-purple-400" : "text-slate-400"
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
  storeId,
  storeName,
  onGoTo,
}: {
  user: { name: string; initial: string };
  pharmacyName: string;
  pendingReview: boolean;
  /** Active store scope: "all" or a store id. */
  storeId: string;
  /** Display name of the scoped store ("" for all stores). */
  storeName: string;
  onGoTo: (page: PharmacyPage) => void;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [sales, setSales] = useState<POSSale[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setItems(loadInventory());
      setRequests(loadStockRequests());
      setDeliveries(loadDeliveries());
      setSales(loadSales());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // The dashboard follows the sidebar's store view — one storefront or all.
  const inScope = <T extends { storeId?: string }>(records: T[]): T[] =>
    storeId === "all" ? records : records.filter((entry) => resolveStoreId(entry) === storeId);

  const scopedItems = inScope(items);
  const scopedRequests = inScope(requests);
  const scopedDeliveries = inScope(deliveries);
  const scopedSales = inScope(sales);

  const skuCount = scopedItems.length;
  const units = scopedItems.reduce((acc, entry) => acc + entry.qty, 0);
  const value = scopedItems.reduce((acc, entry) => acc + entry.qty * entry.unitPrice, 0);
  const pendingCount = scopedRequests.filter((r) => r.status === "pending").length;
  const attentionItems = scopedItems.filter((entry) => entry.qty <= entry.reorderLevel);

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
      tile: "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400",
    },
    {
      id: "items-sold",
      value: String(
        hydrated
          ? scopedSales.reduce((acc, sale) => acc + sale.lines.reduce((a, line) => a + line.qty, 0), 0)
          : "—"
      ),
      label: "Items Sold",
      desc: `From ${scopedSales.length} counter sale${scopedSales.length === 1 ? "" : "s"} at the POS`,
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
    ...scopedRequests.map((r) => ({
      kind: "REQUEST" as const,
      title: `${r.id} · ${r.item} × ${r.qty}`,
      when: r.submittedAt,
    })),
    ...scopedDeliveries.map((d) => ({
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
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-700 via-purple-600 to-fuchsia-600 px-6 py-7 shadow-[0_20px_50px_-20px_rgba(147,51,234,0.55)] sm:px-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-2xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[13.5px] font-medium text-purple-50/90">
              {greeting}, {user.name.split(" ")[0]} 👋
            </p>
            <h1 className="mt-1.5 text-[24px] font-bold leading-tight tracking-tight text-white sm:text-[26px]">
              {pharmacyName}
            </h1>
            <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-purple-50/90">
              Your pharmacy at a glance — stock, requests and deliveries in one place.
            </p>
            {storeId !== "all" && (
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[12px] font-semibold text-white">
                <Store className="h-3.5 w-3.5" aria-hidden="true" />
                {storeName}
              </span>
            )}
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
              className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-4 text-[13.5px] font-semibold text-purple-700 shadow-[0_8px_20px_-8px_rgba(88,28,135,0.5)] transition-colors hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
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
          <button
            type="button"
            onClick={() => onGoTo("balance")}
            className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-purple-200 bg-white px-3.5 text-[13px] font-semibold text-purple-700 transition-colors hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-purple-500/25 dark:bg-transparent dark:text-purple-300 dark:hover:bg-purple-500/10"
          >
            Full stock balance
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
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
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
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
                      : "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
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
  const [stores, setStores] = useState<PharmacyStore[]>([]);
  const [activeStore, setActiveStore] = useState("all");

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
      if (active) {
        setDark(prefersDark);
        setStores(loadStores());
      }
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

  /** Persisted store edits from the Stores page, mirrored into the switcher. */
  const onStoresChange = (next: PharmacyStore[]) => {
    setStores(next);
    saveStores(next);
    // Never keep pointing at a store that no longer exists.
    setActiveStore((current) =>
      current !== "all" && !next.some((store) => store.id === current) ? "all" : current
    );
  };

  const activeStoreName =
    activeStore === "all"
      ? ""
      : stores.find((store) => store.id === activeStore)?.name ?? "";

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
    if (action === "New sale") {
      setMobileOpen(false);
      goTo("pos");
      return;
    }
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
      stores={stores}
      activeStore={activeStore}
      onStoreChange={setActiveStore}
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
        <PulseMark className="h-16 w-16 animate-float" />
        <p className="flex items-center gap-2.5 text-sm text-white/70">
          <span className="h-2 w-2 animate-pulse rounded-full bg-fuchsia-400" aria-hidden="true" />
          {bouncing ? "Taking you to the Pulse console…" : "Preparing your pharmacy workspace…"}
        </p>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh bg-[#f6f5fb] text-slate-900 dark:bg-[#0a0413] dark:text-white">
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
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white/85 px-4 backdrop-blur-md sm:px-6 dark:border-white/10 dark:bg-[#0d0618]/85">
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
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:text-slate-400 dark:hover:bg-white/10"
              >
                <Search className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                aria-label="Notifications"
                onClick={() =>
                  toast({ title: "You're all caught up", description: "No new notifications." })
                }
                className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100/70 text-purple-600 transition-colors hover:bg-purple-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:bg-purple-500/15 dark:text-purple-400 dark:hover:bg-purple-500/25"
              >
                <Bell className="h-[18px] w-[18px]" />
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="btn-brand flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(168,85,247,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
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
            {page === "pos" ? (
              <PharmacyPOS storeId={activeStore} stores={stores} />
            ) : page === "catalogue" ? (
              <PharmacyCatalogue stores={stores} onSell={() => goTo("pos")} />
            ) : page === "orders" ? (
              <PharmacyPurchaseOrders storeId={activeStore} />
            ) : page === "inventory" ? (
              <PharmacyInventory storeId={activeStore} />
            ) : page === "balance" ? (
              <PharmacyStockBalance storeId={activeStore} />
            ) : page === "requests" ? (
              <PharmacyStockRequests storeId={activeStore} />
            ) : page === "deliveries" ? (
              <PharmacyDeliveries storeId={activeStore} />
            ) : page === "suppliers" ? (
              <PharmacySuppliers onGoToRequests={() => goTo("requests")} />
            ) : page === "stores" ? (
              <PharmacyStores stores={stores} onStoresChange={onStoresChange} />
            ) : page === "users" ? (
              <PharmacyUserManagement stores={stores} pharmacyName={pharmacyName} />
            ) : page === "profile" ? (
              <PharmacyProfile user={user} />
            ) : page === "settings" ? (
              <PharmacySettings
                user={user}
                dark={dark}
                onDarkChange={toggleDark}
                onSignOut={onSignOut}
              />
            ) : (
              <PharmacyHome
                user={user}
                pharmacyName={pharmacyName}
                pendingReview={pendingReview}
                storeId={activeStore}
                storeName={activeStoreName}
                onGoTo={goTo}
              />
            )}
          </motion.main>
        </div>
      </div>
    </MotionConfig>
  );
}
