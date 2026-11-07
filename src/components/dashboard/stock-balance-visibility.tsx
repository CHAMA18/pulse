"use client";

import { motion } from "framer-motion";
import {
  BriefcaseMedical,
  ChevronRight,
  Download,
  Eye,
  Home,
  Inbox,
  RefreshCw,
  Search,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

type StockHealth = "healthy" | "low" | "critical" | "out";

type StockRow = {
  id: string;
  product: string;
  sku: string;
  opening: number;
  received: number;
  dispensed: number;
  transferred: number;
  adjusted: number;
  closing: number;
  valueZmw: number;
  daysOfStock: number | null; // null → not applicable
};

type VisibilityPharmacy = {
  id: string;
  name: string;
  address: string;
  rows: StockRow[];
};

type HealthFilter = "all" | StockHealth;

const STORAGE_KEY = "pulse.stock-visibility.v1";

/** Health is derived from closing quantity and days of stock remaining. */
function healthOf(row: StockRow): StockHealth {
  if (row.closing <= 0) return "out";
  if (row.daysOfStock !== null && row.daysOfStock <= 3) return "critical";
  if (row.daysOfStock !== null && row.daysOfStock <= 7) return "low";
  return "healthy";
}

const HEALTH_META: Record<StockHealth, { label: string; pill: string }> = {
  healthy: {
    label: "Healthy",
    pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  low: {
    label: "Low",
    pill: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  },
  critical: {
    label: "Critical",
    pill: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
  },
  out: {
    label: "Out",
    pill: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  },
};

/** The two pharmacies that currently share balances with this console. */
function seedVisibility(): VisibilityPharmacy[] {
  return [
    { id: "vis-apex", name: "Apex Health Pharmacy", address: "Salama Park Lusaka", rows: [] },
    { id: "vis-stackone", name: "StackOne", address: "Lusaka", rows: [] },
  ];
}

function loadVisibility(): VisibilityPharmacy[] {
  if (typeof window === "undefined") return seedVisibility();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedVisibility();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return seedVisibility();
    return parsed.filter(
      (p): p is VisibilityPharmacy =>
        !!p && typeof p === "object" && typeof (p as VisibilityPharmacy).name === "string"
    );
  } catch {
    return seedVisibility();
  }
}

function formatZmw(value: number): string {
  if (value <= 0) return "ZMW 0";
  if (value >= 1_000_000)
    return `ZMW ${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000)
    return `ZMW ${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `ZMW ${Math.round(value)}`;
}

function formatTimestamp(d: Date): string {
  const date = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} • ${time}`;
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
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function Breadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px]">
      <Home className="h-3.5 w-3.5 text-white/70" aria-hidden="true" />
      <ChevronRight className="h-3 w-3 text-white/50" aria-hidden="true" />
      <span className="font-medium text-white/75">Pulse Network</span>
      <ChevronRight className="h-3 w-3 text-white/50" aria-hidden="true" />
      <span className="font-bold text-white" aria-current="page">
        Stock Balance Visibility
      </span>
    </nav>
  );
}

function HeroButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/35 bg-white/10 px-4 text-[13.5px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function HealthPill({ health }: { health: StockHealth }) {
  const meta = HEALTH_META[health];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em]",
        meta.pill
      )}
    >
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function StockBalanceVisibility() {
  const { toast } = useToast();

  const [pharmacies, setPharmacies] = useState<VisibilityPharmacy[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [lastUpdated, setLastUpdated] = useState<string>(() =>
    formatTimestamp(new Date())
  );

  // Hydrate once on mount, then persist every change. Deferred to a frame
  // so we never setState synchronously inside the effect body.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setPharmacies(loadVisibility());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pharmacies));
    } catch {
      /* storage full or unavailable — in-memory state still works */
    }
  }, [pharmacies, hydrated]);

  /* ---------------- derived data ---------------- */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pharmacies.map((p) => ({
      ...p,
      rows: p.rows.filter((row) => {
        if (healthFilter !== "all" && healthOf(row) !== healthFilter) return false;
        if (!q) return true;
        return `${row.product} ${row.sku}`.toLowerCase().includes(q);
      }),
    }));
  }, [pharmacies, query, healthFilter]);

  const totalRows = useMemo(
    () => pharmacies.reduce((sum, p) => sum + p.rows.length, 0),
    [pharmacies]
  );

  /* ---------------- actions ---------------- */

  const refresh = () => {
    setPharmacies(loadVisibility());
    setLastUpdated(formatTimestamp(new Date()));
    toast({
      title: "Stock balances refreshed",
      description: "Visibility data re-synced from the network.",
    });
    void trackEvent("stock_visibility_refreshed");
  };

  const exportCsv = () => {
    if (totalRows === 0) {
      toast({
        title: "Nothing to export yet",
        description: "No stock balances have been recorded by your visibility partners.",
      });
      return;
    }
    const header =
      "pharmacy,product,sku,opening,received,dispensed,transferred,adjusted,closing,value_zmw,days_of_stock,health";
    const lines: string[] = [header];
    for (const p of pharmacies) {
      for (const row of p.rows) {
        lines.push(
          [
            `"${p.name.replace(/"/g, '""')}"`,
            `"${row.product.replace(/"/g, '""')}"`,
            row.sku,
            row.opening,
            row.received,
            row.dispensed,
            row.transferred,
            row.adjusted,
            row.closing,
            row.valueZmw,
            row.daysOfStock ?? "",
            healthOf(row),
          ].join(",")
        );
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pulse-stock-balances.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Export started",
      description: "pulse-stock-balances.csv is downloading.",
    });
    void trackEvent("stock_visibility_exported", { rows: totalRows });
  };

  /* ---------------- render ---------------- */

  const chips: { id: HealthFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "healthy", label: "Healthy" },
    { id: "low", label: "Low" },
    { id: "critical", label: "Critical" },
    { id: "out", label: "Out" },
  ];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col">
      {/* — Hero banner — */}
      <motion.section
        variants={item}
        aria-labelledby="stock-visibility-title"
        className="relative overflow-hidden rounded-3xl bg-[linear-gradient(105deg,#c026d3_0%,#9d2bec_46%,#7c3aed_100%)] px-5 py-7 shadow-[0_24px_60px_-24px_rgba(147,51,234,0.55)] sm:px-7"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(620px_200px_at_18%_0%,rgba(255,255,255,0.22),transparent_62%)]"
        />
        <div className="relative">
          <Breadcrumb />

          <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
                <Eye className="h-6 w-6 text-white" strokeWidth={2.1} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h1
                  id="stock-visibility-title"
                  className="text-[24px] font-bold tracking-tight text-white sm:text-[26px]"
                >
                  Stock Balance Visibility
                </h1>
                <p className="mt-1 max-w-[640px] text-[13.5px] leading-relaxed text-white/85">
                  Real-time stock balances across every participating pharmacy.
                  Track opening, received, dispensed, transferred, adjusted, and
                  closing stock by product — with stock value and days of stock
                  remaining.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
              <HeroButton icon={Download} label="Export" onClick={exportCsv} />
              <HeroButton icon={RefreshCw} label="Refresh" onClick={refresh} />
            </div>
          </div>

          <p className="mt-5 flex items-center gap-2 text-[12.5px] text-white/85">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live · Last updated {lastUpdated}
          </p>
        </div>
      </motion.section>

      {/* — Search — */}
      <motion.div variants={item} className={cn(cardCls, "mt-6 w-full max-w-[400px] p-3.5 sm:p-4")}>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by product name or SKU..."
            aria-label="Search stock balances"
            className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-11 pr-4 text-[14.5px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-slate-300 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20 dark:focus:border-purple-400"
          />
        </div>
      </motion.div>

      {/* — Health filter chips — */}
      <motion.div
        variants={item}
        className="mt-5 flex flex-wrap items-center gap-2.5"
        role="group"
        aria-label="Filter by stock health"
      >
        {chips.map(({ id, label }) => {
          const active = healthFilter === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setHealthFilter(id)}
              className={cn(
                "rounded-full px-5 py-2 text-[13.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                active
                  ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                  : "bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
              )}
            >
              {label}
            </button>
          );
        })}
      </motion.div>

      {/* — Visibility partners — */}
      <div className="mt-5 flex flex-col gap-6">
        {filtered.map((pharmacy) => (
          <motion.section
            key={pharmacy.id}
            variants={item}
            aria-labelledby={`vis-${pharmacy.id}`}
            className={cn(cardCls, "overflow-hidden")}
          >
            <div className="flex items-center gap-3.5 px-5 py-4 sm:px-6">
              <span className="btn-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_8px_18px_-8px_rgba(147,51,234,0.7)]">
                <BriefcaseMedical className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2
                  id={`vis-${pharmacy.id}`}
                  className="truncate text-[17px] font-bold tracking-tight text-slate-900 dark:text-white"
                >
                  {pharmacy.name}
                </h2>
                {pharmacy.address && (
                  <p className="truncate text-[13px] text-slate-500 dark:text-slate-400">
                    {pharmacy.address}
                  </p>
                )}
              </div>
            </div>

            {pharmacy.rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 border-t border-slate-100 px-6 py-12 dark:border-white/5">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5">
                  <Inbox className="h-6 w-6" aria-hidden="true" />
                </span>
                {(() => {
                  const searching = query.trim() || healthFilter !== "all";
                  return searching ? (
                    <>
                      <p className="text-[14.5px] font-semibold text-slate-800 dark:text-white">
                        No matching balances
                      </p>
                      <p className="text-[13.5px] text-slate-500 dark:text-slate-400">
                        {query.trim()
                          ? `Nothing matches “${query.trim()}” at ${pharmacy.name}.`
                          : `No ${healthFilter} products at ${pharmacy.name}.`}
                      </p>
                    </>
                  ) : (
                    <p className="text-[14px] text-slate-500 dark:text-slate-400">
                      No stock balances recorded yet
                    </p>
                  );
                })()}
              </div>
            ) : (
              <div className="overflow-x-auto border-t border-slate-100 dark:border-white/5">
                <table className="w-full min-w-[920px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:border-white/5 dark:text-slate-500">
                      <th scope="col" className="px-5 py-3.5 font-semibold">Product</th>
                      <th scope="col" className="px-4 py-3.5 text-right font-semibold">Opening</th>
                      <th scope="col" className="px-4 py-3.5 text-right font-semibold">Received</th>
                      <th scope="col" className="px-4 py-3.5 text-right font-semibold">Dispensed</th>
                      <th scope="col" className="px-4 py-3.5 text-right font-semibold">Transferred</th>
                      <th scope="col" className="px-4 py-3.5 text-right font-semibold">Adjusted</th>
                      <th scope="col" className="px-4 py-3.5 text-right font-semibold">Closing</th>
                      <th scope="col" className="px-4 py-3.5 text-right font-semibold">Value</th>
                      <th scope="col" className="px-4 py-3.5 text-right font-semibold">Days left</th>
                      <th scope="col" className="px-5 py-3.5 text-right font-semibold">Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pharmacy.rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-slate-50 text-[13.5px] transition-colors last:border-0 hover:bg-purple-50/40 dark:border-white/5 dark:hover:bg-white/[0.03]"
                      >
                        <td className="px-5 py-3.5">
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {row.product}
                          </p>
                          <p className="text-[12px] text-slate-400 dark:text-slate-500">{row.sku}</p>
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{row.opening}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">+{row.received}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-600 dark:text-slate-300">−{row.dispensed}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-600 dark:text-slate-300">−{row.transferred}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{row.adjusted === 0 ? "0" : row.adjusted > 0 ? `+${row.adjusted}` : row.adjusted}</td>
                        <td className="px-4 py-3.5 text-right font-bold tabular-nums text-slate-900 dark:text-white">{row.closing}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatZmw(row.valueZmw)}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {row.daysOfStock === null ? "—" : `${row.daysOfStock}d`}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <HealthPill health={healthOf(row)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.section>
        ))}

        {filtered.length === 0 && (
          <motion.div
            variants={item}
            className={cn(cardCls, "flex min-h-[160px] flex-col items-center justify-center gap-3 p-8 text-center")}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5">
              <SearchX className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="text-[14.5px] font-semibold text-slate-800 dark:text-white">
              No pharmacies match your search
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
