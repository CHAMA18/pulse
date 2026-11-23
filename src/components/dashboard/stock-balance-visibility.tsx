"use client";

import { motion } from "framer-motion";
import {
  BriefcaseMedical,
  Building2,
  ChevronRight,
  Download,
  Eye,
  Home,
  Inbox,
  RefreshCw,
  Search,
  SearchX,
  Store,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { listNetworkInventory, type NetworkInventoryItem, type NetworkInventoryPage } from "@/lib/cloud/pharmacy-inventory";
import { formatCachedAt, loadCachedRead, saveCachedRead } from "@/lib/offline/read-cache";
import { trackEvent } from "@/lib/firebase";
import { cn } from "@/lib/utils";

type StockHealth = "healthy" | "low" | "critical" | "out";
type HealthFilter = "all" | StockHealth;
type PharmacyBalance = { id: string; name: string; rows: NetworkInventoryItem[] };
type ViewState = "loading" | "ready" | "failed";

const CACHE_KEY = "dashboard-stock-balance-visibility";

const HEALTH_META: Record<StockHealth, { label: string; pill: string }> = {
  healthy: { label: "Healthy", pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" },
  low: { label: "Low", pill: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" },
  critical: { label: "Critical", pill: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400" },
  out: { label: "Out", pill: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" },
};

const cardCls = "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";
const inputCls = "h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13.5px] text-slate-900 outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white";

function healthOf(item: NetworkInventoryItem): StockHealth {
  if (item.qty <= 0) return "out";
  const threshold = Math.max(1, Math.round(item.reorderLevel || 0));
  if (threshold > 1 && item.qty <= Math.floor(threshold / 2)) return "critical";
  if (threshold > 0 && item.qty <= threshold) return "low";
  return "healthy";
}

function formatZmw(value: number): string {
  return `ZMW ${(Number.isFinite(value) ? value : 0).toLocaleString("en-ZM", { maximumFractionDigits: 2 })}`;
}

function Breadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px]">
      <Home className="h-3.5 w-3.5 text-white/70" aria-hidden="true" />
      <ChevronRight className="h-3 w-3 text-white/50" aria-hidden="true" />
      <span className="font-medium text-white/75">Pulse Network</span>
      <ChevronRight className="h-3 w-3 text-white/50" aria-hidden="true" />
      <span className="font-bold text-white" aria-current="page">Stock Balance Visibility</span>
    </nav>
  );
}

function HeroButton({ icon: Icon, label, onClick, disabled }: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/35 bg-white/10 px-4 text-[13.5px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
      <Icon className={cn("h-4 w-4", disabled && label === "Refresh" && "animate-spin")} aria-hidden="true" />
      {label}
    </button>
  );
}

function HealthPill({ health }: { health: StockHealth }) {
  const meta = HEALTH_META[health];
  return <span className={cn("inline-flex whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em]", meta.pill)}>{meta.label}</span>;
}

function pharmacyBalances(page: NetworkInventoryPage): PharmacyBalance[] {
  const byId = new Map<string, PharmacyBalance>();
  for (const pharmacy of page.pharmacies) {
    byId.set(pharmacy.id, { id: pharmacy.id, name: pharmacy.name, rows: [] });
  }
  for (const item of page.items) {
    const pharmacy = byId.get(item.pharmacyId) ?? { id: item.pharmacyId, name: item.pharmacyName, rows: [] };
    pharmacy.rows.push(item);
    byId.set(item.pharmacyId, pharmacy);
  }
  return [...byId.values()].map((pharmacy) => ({
    ...pharmacy,
    rows: pharmacy.rows.sort((a, b) =>
      (a.storeName || a.storeId || "Main store").localeCompare(b.storeName || b.storeId || "Main store") ||
      a.name.localeCompare(b.name) || a.batch.localeCompare(b.batch)
    ),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function StockBalanceVisibility() {
  const { toast } = useToast();
  const [pharmacies, setPharmacies] = useState<PharmacyBalance[]>([]);
  const [state, setState] = useState<ViewState>("loading");
  const [query, setQuery] = useState("");
  const [pharmacyFilter, setPharmacyFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [showingCachedData, setShowingCachedData] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const page = await listNetworkInventory(1000);
      setPharmacies(pharmacyBalances(page));
      setCachedAt(Date.now());
      setShowingCachedData(false);
      setState("ready");
      saveCachedRead<NetworkInventoryPage>(CACHE_KEY, page);
    } catch {
      const cached = loadCachedRead<NetworkInventoryPage>(CACHE_KEY);
      if (cached) {
        setPharmacies(pharmacyBalances(cached.data));
        setCachedAt(cached.cachedAt);
        setShowingCachedData(true);
        setState("ready");
      } else {
        setState("failed");
      }
    }
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const totals = useMemo(() => {
    const rows = pharmacies.flatMap((pharmacy) => pharmacy.rows);
    return {
      pharmacies: pharmacies.length,
      stocked: pharmacies.filter((pharmacy) => pharmacy.rows.length > 0).length,
      products: rows.length,
      units: rows.reduce((sum, row) => sum + row.qty, 0),
      value: rows.reduce((sum, row) => sum + row.qty * row.unitPrice, 0),
      low: rows.filter((row) => healthOf(row) === "low" || healthOf(row) === "critical").length,
      out: rows.filter((row) => healthOf(row) === "out").length,
    };
  }, [pharmacies]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pharmacies.flatMap((pharmacy) => {
      if (pharmacyFilter !== "all" && pharmacy.id !== pharmacyFilter) return [];
      const pharmacyMatches = q.length > 0 && `${pharmacy.name} ${pharmacy.id}`.toLowerCase().includes(q);
      const rows = pharmacy.rows.filter((row) => {
        if (healthFilter !== "all" && healthOf(row) !== healthFilter) return false;
        if (!q || pharmacyMatches) return true;
        return `${row.name} ${row.category} ${row.productId ?? ""} ${row.id} ${row.batch} ${row.storeName ?? ""} ${row.storeId ?? ""}`.toLowerCase().includes(q);
      });
      if (healthFilter !== "all" && rows.length === 0) return [];
      if (q && !pharmacyMatches && rows.length === 0) return [];
      return [{ ...pharmacy, rows }];
    });
  }, [pharmacies, query, pharmacyFilter, healthFilter]);

  const filteredItems = useMemo(() => filtered.flatMap((pharmacy) =>
    pharmacy.rows.map((row) => ({ pharmacy, row }))
  ), [filtered]);

  const healthCounts = useMemo(() => {
    const counts: Record<StockHealth, number> = { healthy: 0, low: 0, critical: 0, out: 0 };
    for (const pharmacy of pharmacies) for (const row of pharmacy.rows) counts[healthOf(row)] += 1;
    return counts;
  }, [pharmacies]);

  const exportCsv = () => {
    if (filteredItems.length === 0) {
      toast({ title: "Nothing to export", description: "Adjust the filters to include stock balances." });
      return;
    }
    const lines = ["pharmacy,outlet,product,category,sku,batch,expiry,quantity,reorder_level,retail_price,retail_value,health"];
    for (const { pharmacy, row } of filteredItems) {
      lines.push([
        pharmacy.name,
        row.storeName || row.storeId || "Main store",
        row.name,
        row.category,
        row.productId || row.id,
        row.batch,
        row.expiry,
        row.qty,
        row.reorderLevel,
        row.unitPrice,
        row.qty * row.unitPrice,
        healthOf(row),
      ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "pulse-stock-balances.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export started", description: `Exported ${filteredItems.length} filtered stock lines.` });
    void trackEvent("stock_visibility_exported", { rows: filteredItems.length });
  };

  const resetFilters = () => {
    setQuery("");
    setPharmacyFilter("all");
    setHealthFilter("all");
  };

  const chips: { id: HealthFilter; label: string; count?: number }[] = [
    { id: "all", label: "All", count: totals.products },
    { id: "healthy", label: "Healthy", count: healthCounts.healthy },
    { id: "low", label: "Low", count: healthCounts.low },
    { id: "critical", label: "Critical", count: healthCounts.critical },
    { id: "out", label: "Out", count: healthCounts.out },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6" data-tour="pulse-stock">
      <section aria-labelledby="stock-visibility-title" className="relative overflow-hidden rounded-3xl bg-[linear-gradient(105deg,#c026d3_0%,#9d2bec_46%,#7c3aed_100%)] px-5 py-7 shadow-[0_24px_60px_-24px_rgba(147,51,234,0.55)] sm:px-7">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(620px_200px_at_18%_0%,rgba(255,255,255,0.22),transparent_62%)]" />
        <div className="relative">
          <Breadcrumb />
          <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
                <Eye className="h-6 w-6 text-white" strokeWidth={2.1} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h1 id="stock-visibility-title" className="text-[24px] font-bold tracking-tight text-white sm:text-[26px]">Stock Balance Visibility</h1>
                <p className="mt-1 max-w-[680px] text-[13.5px] leading-relaxed text-white/85">Current shelf balances for every registered pharmacy, organized by outlet. Search products, spot replenishment risks, and export the filtered view.</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <HeroButton icon={Download} label="Export filtered" onClick={exportCsv} disabled={state !== "ready"} />
              <HeroButton icon={RefreshCw} label="Refresh" onClick={() => void load()} disabled={state === "loading"} />
            </div>
          </div>
          <p className="mt-5 flex items-center gap-2 text-[12.5px] text-white/85" aria-live="polite">
            <span className={cn("h-2 w-2 rounded-full", state === "ready" ? "bg-emerald-400" : state === "failed" ? "bg-rose-300" : "bg-amber-300")} aria-hidden="true" />
            {state === "loading" ? "Loading pharmacy balances…" : state === "failed" ? "Network data unavailable" : `${showingCachedData ? "Saved network snapshot" : "Live network data"}${cachedAt ? ` · Updated ${formatCachedAt(cachedAt)}` : ""}`}
          </p>
        </div>
      </section>

      <section aria-label="Network stock summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Registered pharmacies", value: totals.pharmacies, hint: `${totals.stocked} currently reporting stock`, icon: Building2, tone: "text-purple-600 dark:text-purple-300" },
          { label: "Products on shelves", value: totals.products, hint: `${totals.units.toLocaleString()} units across the network`, icon: Inbox, tone: "text-blue-600 dark:text-blue-300" },
          { label: "Replenishment needed", value: totals.low + totals.out, hint: `${totals.low} low or critical · ${totals.out} out`, icon: RefreshCw, tone: "text-amber-600 dark:text-amber-300" },
          { label: "Network retail value", value: formatZmw(totals.value), hint: "On-hand quantity × retail price", icon: BriefcaseMedical, tone: "text-emerald-600 dark:text-emerald-300" },
        ].map(({ label, value, hint, icon: Icon, tone }) => (
          <article key={label} className={cn(cardCls, "p-4 sm:p-5")}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">{label}</p>
              <Icon className={cn("h-4 w-4 shrink-0", tone)} aria-hidden="true" />
            </div>
            <p className="mt-2 truncate text-[20px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-white">{state === "ready" ? value : "—"}</p>
            <p className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">{hint}</p>
          </article>
        ))}
      </section>

      <section aria-label="Search and filter stock balances" className={cn(cardCls, "p-4 sm:p-5")}>
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="relative block min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pharmacy, product, outlet, batch or SKU…" aria-label="Search stock balances" className={cn(inputCls, "w-full pl-9")} />
          </label>
          <select value={pharmacyFilter} onChange={(event) => setPharmacyFilter(event.target.value)} aria-label="Filter by pharmacy" className={cn(inputCls, "lg:min-w-[230px]")}>
            <option value="all">All registered pharmacies</option>
            {pharmacies.map((pharmacy) => <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</option>)}
          </select>
          {(query || pharmacyFilter !== "all" || healthFilter !== "all") && (
            <button type="button" onClick={resetFilters} className="h-10 rounded-lg px-3 text-[13px] font-semibold text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-white/5">Clear filters</button>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by stock health">
          {chips.map(({ id, label, count }) => {
            const active = healthFilter === id;
            return (
              <button key={id} type="button" aria-pressed={active} onClick={() => setHealthFilter(id)} className={cn("rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500", active ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]" : "bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10")}>
                {label} <span className={cn("ml-1 tabular-nums", active ? "text-white/75" : "text-slate-400")}>{count}</span>
              </button>
            );
          })}
          <span className="ml-auto text-[12px] text-slate-500 dark:text-slate-400" aria-live="polite">Showing {filtered.length} pharmacies · {filteredItems.length} stock lines</span>
        </div>
      </section>

      {state === "failed" ? (
        <div className={cn(cardCls, "p-8 text-center")}>
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white">Network stock balances are unavailable</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-slate-500 dark:text-slate-400">Connect to the Pulse network and refresh to load registered pharmacies and their current stock.</p>
          <button type="button" onClick={() => void load()} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-purple-600 px-4 text-[13px] font-semibold text-white"><RefreshCw className="h-4 w-4" /> Retry</button>
        </div>
      ) : state === "loading" && pharmacies.length === 0 ? (
        <div className={cn(cardCls, "flex min-h-[180px] flex-col items-center justify-center gap-2 p-8 text-center")} aria-busy="true">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" aria-hidden="true" />
          <p className="text-[13.5px] text-slate-500 dark:text-slate-400">Loading the registered pharmacy directory and live shelves…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(cardCls, "flex min-h-[160px] flex-col items-center justify-center gap-3 p-8 text-center")}>
          <SearchX className="h-6 w-6 text-slate-400" aria-hidden="true" />
          <p className="text-[14.5px] font-semibold text-slate-800 dark:text-white">No pharmacies or stock lines match these filters</p>
          <button type="button" onClick={resetFilters} className="text-[13px] font-semibold text-purple-600 hover:underline dark:text-purple-300">Clear filters</button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((pharmacy) => {
            const units = pharmacy.rows.reduce((sum, row) => sum + row.qty, 0);
            const value = pharmacy.rows.reduce((sum, row) => sum + row.qty * row.unitPrice, 0);
            const outlets = new Set(pharmacy.rows.map((row) => row.storeName || row.storeId || "Main store")).size;
            const low = pharmacy.rows.filter((row) => healthOf(row) === "low" || healthOf(row) === "critical").length;
            const out = pharmacy.rows.filter((row) => healthOf(row) === "out").length;
            return (
              <motion.section key={pharmacy.id} layout aria-label={`${pharmacy.name} stock balance`} className={cn(cardCls, "overflow-hidden")}>
                <header className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300"><Building2 className="h-5 w-5" aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[16px] font-bold tracking-tight text-slate-900 dark:text-white">{pharmacy.name}</h2>
                    <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{pharmacy.rows.length > 0 ? `${outlets} outlet${outlets === 1 ? "" : "s"} · ` : ""}{pharmacy.rows.length} stock line{pharmacy.rows.length === 1 ? "" : "s"} · {units.toLocaleString()} units</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {low > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{low} low / critical</span>}
                    {out > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{out} out</span>}
                    <span className="text-right">
                      <span className="block text-[14px] font-bold tabular-nums text-slate-900 dark:text-white">{formatZmw(value)}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">retail value</span>
                    </span>
                  </div>
                </header>
                {pharmacy.rows.length === 0 ? (
                  <div className="border-t border-slate-100 px-5 py-5 text-[13px] text-slate-500 dark:border-white/5 dark:text-slate-400">
                    No stock has synced from this pharmacy yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto border-t border-slate-100 dark:border-white/5">
                    <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
                      <thead>
                        <tr className="bg-slate-50/70 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-slate-400 dark:bg-white/[0.025] dark:text-slate-500">
                          <th scope="col" className="px-5 py-3">Product</th>
                          <th scope="col" className="px-3 py-3">Outlet</th>
                          <th scope="col" className="px-3 py-3">Batch / expiry</th>
                          <th scope="col" className="px-3 py-3 text-right">On hand</th>
                          <th scope="col" className="px-3 py-3 text-right">Reorder at</th>
                          <th scope="col" className="px-3 py-3 text-right">Retail price</th>
                          <th scope="col" className="px-3 py-3 text-right">Retail value</th>
                          <th scope="col" className="px-5 py-3 text-right">Health</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {pharmacy.rows.map((row) => (
                          <tr key={row.docId} className="transition-colors hover:bg-purple-50/40 dark:hover:bg-white/[0.03]">
                            <td className="px-5 py-3">
                              <p className="font-semibold text-slate-900 dark:text-white">{row.name}</p>
                              <p className="text-[11.5px] text-slate-500 dark:text-slate-400">{row.category} · {row.productId || row.id}</p>
                            </td>
                            <td className="px-3 py-3 text-slate-600 dark:text-slate-300"><span className="inline-flex items-center gap-1.5"><Store className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />{row.storeName || row.storeId || "Main store"}</span></td>
                            <td className="px-3 py-3 text-slate-600 dark:text-slate-300"><span className="block font-mono text-[11.5px]">{row.batch || "—"}</span><span className="text-[11px] text-slate-400">{row.expiry || "No expiry recorded"}</span></td>
                            <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-900 dark:text-white">{row.qty.toLocaleString()}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{row.reorderLevel.toLocaleString()}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatZmw(row.unitPrice)}</td>
                            <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{formatZmw(row.qty * row.unitPrice)}</td>
                            <td className="px-5 py-3 text-right"><HealthPill health={healthOf(row)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.section>
            );
          })}
        </div>
      )}
      {state === "ready" && <p className="text-[11.5px] text-slate-400 dark:text-slate-500">Balances are current snapshots synced by each pharmacy. Movement history is available in Stock Movement.</p>}
    </motion.div>
  );
}
