"use client";

import { motion, MotionConfig } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  Bell,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  Eye,
  History,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  PackageCheck,
  PackageSearch,
  Receipt,
  Search,
  ShoppingBasket,
  Store,
  TrendingUp,
  TriangleAlert,
  Truck,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PulseMark } from "@/components/login/pulse-logo";
import {
  DashboardWalkthrough,
  PULSE_TOUR_STEPS,
} from "@/components/dashboard/dashboard-walkthrough";
import { SupplierManagement } from "@/components/dashboard/supplier-management";
import { PulsePharmacies } from "@/components/dashboard/pulse-pharmacies";
import { StockBalanceVisibility } from "@/components/dashboard/stock-balance-visibility";
import { UserManagement } from "@/components/dashboard/user-management";
import { AuditLogs } from "@/components/dashboard/audit-logs";
import { PharmacySalesReport } from "@/components/dashboard/pharmacy-sales-report";
import { PharmacyCatalogue } from "@/components/pharmacy/pharmacy-catalogue";
import { PharmacyStockMovement } from "@/components/pharmacy/pharmacy-stock-movement";
import {
  formatDay,
  loadDeliveries,
  loadInventory,
  loadMovements,
  loadSales,
  loadStores,
  MOVEMENT_TYPE_META,
  type InventoryItem,
  type PharmacyStore,
  type StockMovement,
} from "@/components/pharmacy/pharmacy-data";
import { WalkthroughTour } from "@/components/walkthrough/walkthrough";
import { recordAudit, WORKSPACE_NAME } from "@/lib/audit-log";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { clearStoredPortal, getStoredPortal } from "@/lib/portal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  getFirebaseAuth,
  getFirebaseDb,
  getInvitedAccountRole,
  trackEvent,
} from "@/lib/firebase";
import {
  canOpenPulsePage,
  normalizePulseRole,
  PULSE_ROLE_META,
  type PulsePage as DashboardPage,
  type PulseRole,
} from "@/lib/pulse-rbac";

/* ------------------------------------------------------------------ */
/* Content model — mirrors the live system's home snapshot             */
/* ------------------------------------------------------------------ */

/** Compact ZMW readout ("ZMW 7.4K") for the overview cards. */
function compactZMW(value: number): string {
  if (value <= 0) return "ZMW 0";
  if (value >= 1_000_000) return `ZMW ${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `ZMW ${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `ZMW ${Math.round(value)}`;
}

/** Everything on the overview is derived from records saved on this device. */
type HomeSnapshot = {
  inventoryValue: number;
  skuCount: number;
  itemsSold: number;
  goodsReceived: number;
  lowStock: InventoryItem[];
  expiring: InventoryItem[];
  salesCount: number;
  movementCount: number;
  recent: StockMovement[];
};

const WATCH_WINDOW = 90 * 24 * 60 * 60 * 1000;

function buildHomeSnapshot(): HomeSnapshot {
  const items = loadInventory();
  const sales = loadSales();
  const deliveries = loadDeliveries();
  const movements = loadMovements();
  const cutoff = Date.now() + WATCH_WINDOW;

  return {
    inventoryValue: items.reduce((acc, item) => acc + Math.max(0, item.qty) * item.unitPrice, 0),
    skuCount: items.filter((item) => item.qty > 0).length,
    itemsSold: sales.reduce(
      (acc, sale) => acc + sale.lines.reduce((units, line) => units + line.qty, 0),
      0
    ),
    goodsReceived: deliveries.length,
    lowStock: items
      .filter((item) => item.qty <= item.reorderLevel)
      .sort((a, b) => a.qty - b.qty),
    expiring: items
      .filter((item) => item.qty > 0 && Date.parse(item.expiry) <= cutoff)
      .sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry)),
    salesCount: sales.length,
    movementCount: movements.length,
    recent: [...movements].sort((a, b) => b.at - a.at).slice(0, 2),
  };
}

function statCards(home: HomeSnapshot | null) {
  const skuLabel = home
    ? `${home.skuCount} active SKU${home.skuCount === 1 ? "" : "s"} on the shelves`
    : "Reading the saved shelves…";
  return [
    {
      id: "inventory-value",
      value: home ? compactZMW(home.inventoryValue) : "—",
      label: "Inventory Value",
      desc: skuLabel,
      icon: ShoppingBasket,
      tile: "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400",
    },
    {
      id: "items-sold",
      value: home ? String(home.itemsSold) : "—",
      label: "Items Sold",
      desc: "Sell-through captured from POS",
      icon: Calculator,
      tile: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
    },
    {
      id: "goods-received",
      value: home ? String(home.goodsReceived) : "—",
      label: "Goods Received",
      desc: "Credit supply deliveries recorded",
      icon: Truck,
      tile: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
    },
    {
      id: "low-stock",
      value: home ? String(home.lowStock.length) : "—",
      label: "Low Stock Alerts",
      desc: "Items approaching reorder levels",
      icon: TriangleAlert,
      tile: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
    },
  ];
}

const QUICK_ACTIONS = ["Add product", "Record stock movement", "Invite pharmacy staff"];

const QUICK_ACTION_PAGES: Record<(typeof QUICK_ACTIONS)[number], DashboardPage> = {
  "Add product": "catalogue",
  "Record stock movement": "movement",
  "Invite pharmacy staff": "users",
};

type NavItem = { label: string; icon: LucideIcon; page: DashboardPage };

/** Human page titles used in the audit trail ("Viewed Pulse Pharmacies"). */
const PAGE_AUDIT_TITLES: Record<DashboardPage, string> = {
  home: "Dashboard",
  audit: "Audit Logs",
  users: "User Management",
  pharmacies: "Pulse Pharmacies",
  sales: "Sales Report",
  catalogue: "Product Catalogue",
  movement: "Stock Movement",
  stock: "Stock Balance Visibility",
  suppliers: "Supplier Management",
  walkthrough: "Walkthrough",
};

const NAV_SECTIONS: { section: string; items: NavItem[] }[] = [
  { section: "Main", items: [{ label: "Home", page: "home", icon: Home }] },
  {
    section: "Admin",
    items: [
      { label: "Audit Logs", page: "audit", icon: History },
      { label: "User Management", page: "users", icon: UserCog },
    ],
  },
  {
    section: "Pulse Network",
    items: [
      { label: "Pulse Pharmacies", page: "pharmacies", icon: LayoutGrid },
      { label: "Sales Report", page: "sales", icon: Receipt },
      { label: "Product Catalogue", page: "catalogue", icon: PackageSearch },
      { label: "Stock Movement", page: "movement", icon: ArrowLeftRight },
      { label: "Stock Balance Visibility", page: "stock", icon: Eye },
      { label: "Supplier Management", page: "suppliers", icon: Store },
    ],
  },
  { section: "Learn", items: [{ label: "Walkthrough", page: "walkthrough", icon: Compass }] },
];

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
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-[21px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="text-[13.5px] text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        cardCls,
        "flex min-h-[64px] items-center justify-center gap-2 px-4 py-5 text-[13.5px] text-slate-500 dark:text-slate-400"
      )}
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function SidebarContent({
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
  onNavClick: (target: DashboardPage) => void;
  onQuickAction: (action?: string) => void;
  onClose?: () => void;
  user: { name: string; email: string; initial: string; role: PulseRole };
  page: DashboardPage;
}) {
  const [quickOpen, setQuickOpen] = useState(false);
  const canOpen = (target: DashboardPage) => canOpenPulsePage(user.role, target);
  const visibleQuickActions = QUICK_ACTIONS.filter((action) =>
    canOpen(QUICK_ACTION_PAGES[action])
  );

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#100823]">
      {/* Logo */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-slate-100 dark:border-white/5",
          collapsed ? "justify-center px-0" : "gap-2.5 px-5"
        )}
      >
        <PulseMark className="h-9 w-9 shrink-0" glow={false} />
        {!collapsed && (
          <span className="text-brand-gradient select-none text-[22px] font-bold tracking-tight">
            Pulse
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
          <span className="btn-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white">
            {user.initial}
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">
                {user.name}
              </p>
              <span
                className={cn(
                  "mt-0.5 inline-block rounded-full px-2 py-px text-[11px] font-semibold",
                  PULSE_ROLE_META[user.role].pill
                )}
              >
                {PULSE_ROLE_META[user.role].label}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="pulse-scroll flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary" data-tour="pulse-nav">
        {NAV_SECTIONS.map(({ section, items }) => {
          const visibleItems = items.filter(({ page: targetPage }) => canOpen(targetPage));
          if (visibleItems.length === 0) return null;
          return (
            <div key={section} className="mt-4 first:mt-1">
              {!collapsed ? (
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  {section}
                </p>
              ) : (
                <div className="mx-auto my-3 h-px w-8 bg-slate-100 dark:bg-white/10" />
              )}
              <div className="flex flex-col gap-0.5">
                {visibleItems.map(({ label, page: targetPage, icon: Icon }) => {
                  const active = targetPage === page;
                  return (
                    <button
                      key={label}
                      type="button"
                      title={collapsed ? label : undefined}
                      aria-current={active ? "page" : undefined}
                      onClick={() => onNavClick(targetPage)}
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
          );
        })}
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

        {/* Quick access — hidden when the role has none of its actions */}
        {visibleQuickActions.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() =>
                collapsed ? onCollapsedChange?.(false) : setQuickOpen((v) => !v)
              }
              className={cn(
                "flex w-full items-center gap-3 rounded-lg text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5",
                collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2"
              )}
              aria-expanded={quickOpen}
              title={collapsed ? "Quick Access" : undefined}
            >
              <LayoutGrid className="h-[18px] w-[18px] shrink-0 text-slate-400" aria-hidden="true" />
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
                {visibleQuickActions.map((action) => (
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
        )}

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
/* Dashboard app shell                                                 */
/* ------------------------------------------------------------------ */

export function DashboardApp() {
  const { toast } = useToast();
  const router = useRouter();

  const [dark, setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [page, setPage] = useState<DashboardPage>("home");
  const [user, setUser] = useState({
    uid: "",
    name: "Pulse User",
    email: "",
    initial: "P",
    role: "staff" as PulseRole,
  });
  const [networkStores, setNetworkStores] = useState<PharmacyStore[]>([]);
  const [home, setHome] = useState<HomeSnapshot | null>(null);
  const [bouncing, setBouncing] = useState(false);
  // Interactive walkthrough — shell level, so it rides above every page.
  const [tourOpen, setTourOpen] = useState(false);

  // Restore the signed-in identity + theme preference (async so we never
  // setState synchronously inside the effect body).
  useEffect(() => {
    let active = true;

    void (async () => {
      // Sessions that signed in through the Pharmacy portal live in their own
      // console — the Pulse admin interface is never shown to them.
      if (getStoredPortal() === "pharmacy") {
        if (active) {
          setBouncing(true);
          router.replace("/pharmacy");
        }
        return;
      }

      const auth = getFirebaseAuth();
      try {
        await auth?.authStateReady();
      } catch {
        /* fall through — read whatever identity is available */
      }
      if (!active) return;

      const current = auth?.currentUser;
      const name = current?.displayName ?? current?.email?.split("@")[0] ?? "Pulse User";
      const email = current?.email ?? "";

      // The invitation carries the console role; read it from the Firestore
      // profile first, then fall back to the invitation accepted on this device.
      let role: PulseRole | undefined;
      const store = getFirebaseDb();
      if (store && current) {
        try {
          const snap = await getDoc(doc(store, "User", current.uid));
          const profile = snap.data() as
            | { role?: string; role_label?: string; access_revoked?: boolean }
            | undefined;
          if (profile?.access_revoked === true) {
            try {
              await signOut(auth!);
            } catch {
              /* the local session is cleared below regardless */
            }
            clearStoredPortal();
            if (active) {
              toast({
                title: "Console access removed",
                description: "An Owner has removed this account from the Pulse console.",
              });
              router.replace("/login");
            }
            return;
          }
          role = normalizePulseRole(profile?.role ?? profile?.role_label);
        } catch {
          /* rules or offline — the local invitation fallback below still applies */
        }
      }
      role ??= normalizePulseRole(
        current ? getInvitedAccountRole(current.uid, email) : null
      );

      if (!active) return;
      setUser({
        uid: current?.uid ?? "",
        name,
        email,
        initial: (name[0] ?? "P").toUpperCase(),
        role: role ?? "staff",
      });
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
    void trackEvent("dashboard_view");
  }, []);

  useEffect(() => {
    let active = true;
    const raf = requestAnimationFrame(() => {
      if (!active) return;
      setNetworkStores(loadStores());
      setHome(buildHomeSnapshot());
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // Keep the console on a page this role may open after the profile resolves.
  useEffect(() => {
    if (!canOpenPulsePage(user.role, page)) setPage("home");
  }, [user.role, page]);

  // Every visited page leaves a "Viewed <Page>" entry in the audit trail.
  useEffect(() => {
    if (bouncing || !user.email) return;
    recordAudit({
      title: `Viewed ${PAGE_AUDIT_TITLES[page]}`,
      action: "View",
      detail: WORKSPACE_NAME,
      actor: user.name,
      email: user.email,
    });
  }, [page, user.email, user.name]);

  const toggleDark = (on: boolean) => {
    setDark(on);
    document.documentElement.classList.toggle("dark", on);
    window.localStorage.setItem("pulse-theme", on ? "dark" : "light");
  };

  const onNavClick = (target: DashboardPage) => {
    setMobileOpen(false);
    if (!canOpenPulsePage(user.role, target)) {
      toast({
        title: "Not available for your role",
        description: `Your ${PULSE_ROLE_META[user.role].label} role doesn't include this area.`,
      });
      return;
    }
    if (target === page) return;
    setPage(target);
    if (user.email) {
      recordAudit({
        title: "Sidebar navigation",
        action: "View",
        detail: WORKSPACE_NAME,
        actor: user.name,
        email: user.email,
      });
    }
    void trackEvent("nav_click", { page: target });
  };

  const onQuickAction = (action?: string) => {
    const target =
      action === "Add product"
        ? "catalogue"
        : action === "Record stock movement"
          ? "movement"
          : action === "Invite pharmacy staff"
            ? "users"
            : undefined;
    if (target) {
      onNavClick(target);
      return;
    }
    toast({
      title: "Quick Access",
      description: "Expand the sidebar to choose an action.",
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
    void trackEvent("logout", { portal: "pulse" });
    toast({ title: "Signed out", description: "See you soon!" });
    router.replace("/");
  };

  const tourSteps = PULSE_TOUR_STEPS.filter(
    (step) => !step.page || canOpenPulsePage(user.role, step.page as DashboardPage)
  );

  const sidebar = (extra: { collapsed: boolean; onCollapsedChange?: (c: boolean) => void; onClose?: () => void }) => (
    <SidebarContent
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

  // While a pharmacy-portal session is being redirected to its own console,
  // hold the branded splash — never flash the admin interface.
  if (bouncing) {
    return (
      <div
        className="pulse-space flex min-h-dvh flex-col items-center justify-center gap-5"
        aria-live="polite"
        aria-busy="true"
      >
        <PulseMark className="h-14 w-14 animate-float" />
        <p className="flex items-center gap-2.5 text-sm text-white/70">
          <span className="h-2 w-2 animate-pulse rounded-full bg-fuchsia-400" aria-hidden="true" />
          Taking you to the Pharmacy portal…
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
            {page === "suppliers" ? (
              <SupplierManagement />
            ) : page === "pharmacies" ? (
              <PulsePharmacies />
            ) : page === "sales" ? (
              <PharmacySalesReport />
            ) : page === "stock" ? (
              <StockBalanceVisibility />
            ) : page === "catalogue" ? (
              <PharmacyCatalogue stores={networkStores} />
            ) : page === "movement" ? (
              <PharmacyStockMovement
                storeId="all"
                stores={networkStores}
                actor={{ name: user.name, email: user.email }}
              />
            ) : page === "users" ? (
              <UserManagement role={user.role} currentUid={user.uid} />
            ) : page === "audit" ? (
              <AuditLogs />
            ) : page === "walkthrough" ? (
              <DashboardWalkthrough
                onGoTo={(target) => onNavClick(target as DashboardPage)}
                onStartTour={() => setTourOpen(true)}
                allowedPages={(target) =>
                  canOpenPulsePage(user.role, target as DashboardPage)
                }
              />
            ) : (
              <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-4" data-tour="pulse-home">
              {statCards(home).map(({ id, value, label, desc, icon: Icon, tile }) => (
                <motion.div key={id} variants={item} className={cn(cardCls, "flex items-center gap-4 p-5")}>
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

            {/* Inventory Health + Movement Pulse — stacked, not side by side */}
            <div className="mt-9 grid grid-cols-1 gap-y-6">
              <motion.section variants={item} aria-labelledby="inventory-health">
                <SectionHeader
                  icon={PackageCheck}
                  title="Inventory Health"
                  subtitle="What needs attention right now"
                />
                <div className="mt-4">
                  {home === null ? (
                    <EmptyState>Reading the saved shelves…</EmptyState>
                  ) : home.lowStock.length === 0 ? (
                    <EmptyState>All clear — nothing is at or below its reorder level.</EmptyState>
                  ) : (
                    <ul className={cn(cardCls, "divide-y divide-slate-100 dark:divide-white/10")}>
                      {home.lowStock.map((item) => (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                        >
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                              item.qty === 0
                                ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                            )}
                          >
                            {item.qty === 0 ? "Out of stock" : "Low stock"}
                          </span>
                          <span className="text-[14px] font-semibold text-slate-900 dark:text-white">
                            {item.name}
                          </span>
                          <span className="text-[12.5px] text-slate-500 dark:text-slate-400">
                            {item.category} · {item.qty} on hand · reorder at {item.reorderLevel}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </motion.section>

              <motion.section variants={item} aria-labelledby="movement-pulse">
                <SectionHeader
                  icon={TrendingUp}
                  title="Movement Pulse"
                  subtitle="Sales, deliveries, and transfers"
                />
                <div className={cn(cardCls, "mt-4 p-5")}>
                  <div className="flex flex-col gap-3.5">
                    {[
                      { label: "Sales", value: home?.salesCount ?? 0, dot: "bg-emerald-500" },
                      { label: "Goods received", value: home?.goodsReceived ?? 0, dot: "bg-amber-500" },
                      { label: "Stock movements", value: home?.movementCount ?? 0, dot: "bg-purple-500" },
                    ].map(({ label, value, dot }) => (
                      <div key={label} className="flex items-center gap-2.5 text-sm">
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dot)} aria-hidden="true" />
                        <span className="font-medium text-slate-700 dark:text-slate-300">{label}</span>
                        <span className="ml-auto font-bold tabular-nums">{home ? value : "—"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
                    {home && home.recent.length > 0 ? (
                      <ul className="flex flex-col gap-4">
                        {home.recent.map((movement) => (
                          <li key={movement.id} className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                              <ArrowDownLeft className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-[13px] font-bold tracking-wide">
                                {MOVEMENT_TYPE_META[movement.type].label.toUpperCase()}
                              </p>
                              <p className="truncate text-[13px] text-slate-500 dark:text-slate-400">
                                {movement.productName} · {movement.reason}
                              </p>
                            </div>
                            <time className="ml-auto shrink-0 whitespace-nowrap text-[13px] text-slate-500 dark:text-slate-400">
                              {new Date(movement.at).toLocaleString("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </time>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[13px] text-slate-500 dark:text-slate-400">
                        {home ? "No stock movements recorded yet." : "Reading the saved ledger…"}
                      </p>
                    )}
                  </div>
                </div>
              </motion.section>
            </div>

            {/* Supply Watchlist */}
            <motion.section variants={item} className="mt-9" aria-labelledby="supply-watchlist">
              <SectionHeader
                icon={Eye}
                title="Supply Watchlist"
                subtitle="SKUs approaching reorder or expiry pressure"
              />                <div className="mt-4">
                  {home === null ? (
                    <EmptyState>Reading expiry dates…</EmptyState>
                  ) : home.expiring.length === 0 ? (
                    <EmptyState>No SKUs are approaching reorder or expiry thresholds.</EmptyState>
                  ) : (
                    <ul className={cn(cardCls, "divide-y divide-slate-100 dark:divide-white/10")}>
                      {home.expiring.map((item) => {
                        const expires = Date.parse(item.expiry);
                        const expired = expires <= Date.now();
                        return (
                          <li
                            key={item.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                          >
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                                expired
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                              )}
                            >
                              {expired ? "Expired" : "Expiring"}
                            </span>
                            <span className="text-[14px] font-semibold text-slate-900 dark:text-white">
                              {item.name}
                            </span>
                            <span className="text-[12.5px] text-slate-500 dark:text-slate-400">
                              {item.category} · {item.qty} on hand · {expired ? "expired" : "expires"}{" "}
                              {formatDay(expires)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
            </motion.section>
              </>
            )}
          </motion.main>
        </div>
      </div>

      {/* Interactive walkthrough — an overlay above every page */}
      {tourOpen && (
        <WalkthroughTour
          steps={tourSteps}
          portalLabel="Pulse console"
          onNavigate={(target) => onNavClick(target as DashboardPage)}
          onFinish={() => {
            setTourOpen(false);
            setPage("walkthrough");
            toast({
              title: "Walkthrough complete 🎉",
              description: "Replay it any time from Walkthrough in the sidebar.",
            });
            if (user.email) {
              recordAudit({
                title: "Walkthrough Completed",
                action: "View",
                detail: WORKSPACE_NAME,
                actor: user.name,
                email: user.email,
              });
            }
            void trackEvent("pulse_walkthrough_completed", { portal: "pulse" });
          }}
        />
      )}
    </MotionConfig>
  );
}
