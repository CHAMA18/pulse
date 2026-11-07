"use client";

import { motion, MotionConfig } from "framer-motion";
import {
  ArrowDownLeft,
  BarChart3,
  Bell,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Eye,
  History,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  PackageCheck,
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
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PulseMark } from "@/components/login/pulse-logo";
import { SupplierManagement } from "@/components/dashboard/supplier-management";
import { PulsePharmacies } from "@/components/dashboard/pulse-pharmacies";
import { StockBalanceVisibility } from "@/components/dashboard/stock-balance-visibility";
import { UserManagement } from "@/components/dashboard/user-management";
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
import { getFirebaseAuth, trackEvent } from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Content model — mirrors the live system's home snapshot             */
/* ------------------------------------------------------------------ */

const STAT_CARDS: {
  id: string;
  value: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  tile: string;
}[] = [
  {
    id: "inventory-value",
    value: "ZMW 7.44K",
    label: "Inventory Value",
    desc: "272 active SKUs in the pharmacy",
    icon: ShoppingBasket,
    tile: "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400",
  },
  {
    id: "items-sold",
    value: "0",
    label: "Items Sold",
    desc: "Sell-through captured from POS",
    icon: Calculator,
    tile: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  {
    id: "goods-received",
    value: "1",
    label: "Goods Received",
    desc: "Credit supply deliveries recorded",
    icon: Truck,
    tile: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  },
  {
    id: "low-stock",
    value: "0",
    label: "Low Stock Alerts",
    desc: "Items approaching reorder levels",
    icon: TriangleAlert,
    tile: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
  },
];

const MOVEMENT_LEGEND: { label: string; value: number; dot: string }[] = [
  { label: "Sales", value: 0, dot: "bg-emerald-500" },
  { label: "Goods received", value: 1, dot: "bg-amber-500" },
  { label: "Stock movements", value: 2, dot: "bg-purple-500" },
];

const MOVEMENT_FEED = [
  { kind: "RECEIVED", title: "Recorded stock movement", when: "Jun 19, 6:15 PM" },
  { kind: "RECEIVED", title: "Done", when: "Jun 13, 10:07 AM" },
];

const QUICK_ACTIONS = ["Add product", "Record stock movement", "Invite pharmacy staff"];

type NavItem = { label: string; icon: LucideIcon };

type DashboardPage = "home" | "suppliers" | "pharmacies" | "stock" | "users";

const NAV_SECTIONS: { section: string; items: NavItem[] }[] = [
  { section: "Main", items: [{ label: "Home", icon: Home }] },
  {
    section: "Admin",
    items: [
      { label: "Audit Logs", icon: History },
      { label: "User Management", icon: UserCog },
    ],
  },
  {
    section: "Pulse Network",
    items: [
      { label: "Pulse Pharmacies", icon: LayoutGrid },
      { label: "Stock Balance Visibility", icon: Eye },
      { label: "Onboarding Requests", icon: ClipboardList },
      { label: "Network Analytics", icon: BarChart3 },
      { label: "Supplier Management", icon: Store },
    ],
  },
];

/** Which sidebar entries are live pages vs. "coming soon" stubs. */
const LIVE_PAGES: Record<string, DashboardPage> = {
  Home: "home",
  "User Management": "users",
  "Pulse Pharmacies": "pharmacies",
  "Stock Balance Visibility": "stock",
  "Supplier Management": "suppliers",
};

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
  onNavClick: (label: string) => void;
  onQuickAction: (action?: string) => void;
  onClose?: () => void;
  user: { name: string; email: string; initial: string };
  page: DashboardPage;
}) {
  const [quickOpen, setQuickOpen] = useState(false);

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
              <span className="mt-0.5 inline-block rounded-full bg-purple-100 px-2 py-px text-[11px] font-semibold text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
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
/* Dashboard app shell                                                 */
/* ------------------------------------------------------------------ */

export function DashboardApp() {
  const { toast } = useToast();
  const router = useRouter();

  const [dark, setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [page, setPage] = useState<DashboardPage>("home");
  const [user, setUser] = useState({ name: "Pulse User", email: "", initial: "P" });

  // Restore the signed-in identity + theme preference (async so we never
  // setState synchronously inside the effect body).
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
      const name = current?.displayName ?? current?.email?.split("@")[0] ?? "Pulse User";
      setUser({
        name,
        email: current?.email ?? "",
        initial: (name[0] ?? "P").toUpperCase(),
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
  }, []);

  useEffect(() => {
    void trackEvent("dashboard_view");
  }, []);

  const toggleDark = (on: boolean) => {
    setDark(on);
    document.documentElement.classList.toggle("dark", on);
    window.localStorage.setItem("pulse-theme", on ? "dark" : "light");
  };

  const onNavClick = (label: string) => {
    setMobileOpen(false);
    const target = LIVE_PAGES[label];
    if (target && target !== page) {
      setPage(target);
      void trackEvent("nav_click", { page: target });
      return;
    }
    if (target) return; // already on that page
    toast({
      title: `${label} is coming soon`,
      description: "This area of the Pulse console is on its way.",
    });
  };

  const onQuickAction = (action?: string) => {
    toast({
      title: `${action ?? "Quick access"} is coming soon`,
      description: "Shortcuts land here as the console grows.",
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
    void trackEvent("logout");
    toast({ title: "Signed out", description: "See you soon!" });
    router.replace("/");
  };

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
            ) : page === "stock" ? (
              <StockBalanceVisibility />
            ) : page === "users" ? (
              <UserManagement />
            ) : (
              <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-4">
              {STAT_CARDS.map(({ id, value, label, desc, icon: Icon, tile }) => (
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
                  <EmptyState>All clear — nothing needs attention right now.</EmptyState>
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
                    {MOVEMENT_LEGEND.map(({ label, value, dot }) => (
                      <div key={label} className="flex items-center gap-2.5 text-sm">
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dot)} aria-hidden="true" />
                        <span className="font-medium text-slate-700 dark:text-slate-300">{label}</span>
                        <span className="ml-auto font-bold tabular-nums">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
                    <ul className="flex flex-col gap-4">
                      {MOVEMENT_FEED.map(({ kind, title, when }, index) => (
                        <li key={`${when}-${index}`} className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                            <ArrowDownLeft className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13px] font-bold tracking-wide">{kind}</p>
                            <p className="truncate text-[13px] text-slate-500 dark:text-slate-400">{title}</p>
                          </div>
                          <time className="ml-auto shrink-0 whitespace-nowrap text-[13px] text-slate-500 dark:text-slate-400">
                            {when}
                          </time>
                        </li>
                      ))}
                    </ul>
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
              />
              <div className="mt-4">
                <EmptyState>No SKUs are approaching reorder or expiry thresholds.</EmptyState>
              </div>
            </motion.section>
              </>
            )}
          </motion.main>
        </div>
      </div>
    </MotionConfig>
  );
}
