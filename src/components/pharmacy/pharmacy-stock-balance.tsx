"use client";

import { motion } from "framer-motion";
import {
  Boxes,
  CheckCircle2,
  Download,
  Search,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatZMW,
  loadInventory,
  type InventoryItem,
} from "@/components/pharmacy/pharmacy-data";
import {
  PageHeader,
  pharmacyCardCls,
  StatusPill,
  stockStatusOf,
  type StockStatus,
} from "@/components/pharmacy/pharmacy-shared";
import { recordAudit } from "@/lib/audit-log";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Filters & sorting                                                   */
/* ------------------------------------------------------------------ */

type BalanceFilter = "all" | StockStatus;
type SortKey = "name" | "qty" | "value" | "expiry";

const FILTERS: { id: BalanceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "healthy", label: "Healthy" },
  { id: "low", label: "Low" },
  { id: "out", label: "Out of stock" },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: "name", label: "Name A–Z" },
  { id: "qty", label: "Qty high → low" },
  { id: "value", label: "Value high → low" },
  { id: "expiry", label: "Expiring soonest" },
];

const DAY = 24 * 60 * 60 * 1000;
/** Items inside this window (or already expired) land on the expiry watch. */
const EXPIRY_WATCH_DAYS = 90;

function StatChip({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex min-w-[128px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
      <p className={cn("text-[18px] font-bold leading-none tracking-tight", tone)}>{value}</p>
      <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

/** Days until a batch expires (negative = already expired). */
function daysToExpiry(iso: string, now: number): number {
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - now) / DAY);
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PharmacyStockBalance() {
  const { toast } = useToast();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BalanceFilter>("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("value");
  const [now, setNow] = useState(() => Date.now());
  const [actor, setActor] = useState({ name: "", email: "" });

  // Restore the shelves + the signed-in identity (for the audit trail).
  useEffect(() => {
    let active = true;
    void (async () => {
      const { getFirebaseAuth } = await import("@/lib/firebase");
      const auth = getFirebaseAuth();
      try {
        await auth?.authStateReady();
      } catch {
        /* fall through */
      }
      if (!active) return;
      const current = auth?.currentUser;
      setActor({
        name: current?.displayName ?? current?.email?.split("@")[0] ?? "Pharmacy Owner",
        email: current?.email ?? "",
      });
    })();

    const raf = requestAnimationFrame(() => {
      setItems(loadInventory());
      setNow(Date.now());
      setHydrated(true);
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(items.map((entry) => entry.category))).sort(),
    [items]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((entry) => {
      const matchesQuery =
        !q ||
        entry.name.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q) ||
        entry.batch.toLowerCase().includes(q);
      const matchesCategory = category === "all" || entry.category === category;
      const status = stockStatusOf(entry.qty, entry.reorderLevel);
      const matchesFilter = filter === "all" || status === filter;
      return matchesQuery && matchesCategory && matchesFilter;
    });
    return list.sort((a, b) => {
      switch (sort) {
        case "qty":
          return b.qty - a.qty;
        case "value":
          return b.qty * b.unitPrice - a.qty * a.unitPrice;
        case "expiry":
          return new Date(a.expiry).getTime() - new Date(b.expiry).getTime();
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [items, query, category, filter, sort]);

  const units = items.reduce((acc, entry) => acc + entry.qty, 0);
  const value = items.reduce((acc, entry) => acc + entry.qty * entry.unitPrice, 0);
  const lowCount = items.filter((e) => stockStatusOf(e.qty, e.reorderLevel) === "low").length;
  const outCount = items.filter((e) => stockStatusOf(e.qty, e.reorderLevel) === "out").length;
  const healthyCount = items.length - lowCount - outCount;

  /** Value share per category — the balance at a glance. */
  const byCategory = useMemo(() => {
    const map = new Map<string, { units: number; value: number }>();
    for (const entry of items) {
      const agg = map.get(entry.category) ?? { units: 0, value: 0 };
      agg.units += entry.qty;
      agg.value += entry.qty * entry.unitPrice;
      map.set(entry.category, agg);
    }
    return Array.from(map.entries())
      .map(([name, agg]) => ({ name, ...agg, share: value > 0 ? agg.value / value : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [items, value]);

  /** Batches inside the expiry watch window, soonest first. */
  const expiryWatch = useMemo(
    () =>
      items
        .map((entry) => ({ entry, days: daysToExpiry(entry.expiry, now) }))
        .filter(({ days }) => days <= EXPIRY_WATCH_DAYS)
        .sort((a, b) => a.days - b.days)
        .slice(0, 4),
    [items, now]
  );

  /** Download the currently filtered balance as CSV. */
  const exportCsv = () => {
    const header =
      "Product,Category,Batch,Expiry,On hand,Reorder level,Unit price (ZMW),Stock value (ZMW),Status";
    const rows = filtered.map((entry) =>
      [
        entry.name,
        entry.category,
        entry.batch,
        entry.expiry,
        entry.qty,
        entry.reorderLevel,
        entry.unitPrice,
        entry.qty * entry.unitPrice,
        stockStatusOf(entry.qty, entry.reorderLevel),
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[`\uFEFF${header}`, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stock-balance-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Stock balance exported",
      description: `${filtered.length} items saved as CSV.`,
    });
    if (actor.email) {
      recordAudit({
        title: "Stock Balance Exported",
        action: "Export",
        detail: `${filtered.length} items · ${formatZMW(
          filtered.reduce((acc, entry) => acc + entry.qty * entry.unitPrice, 0)
        )} filtered value`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_stock_balance_exported", { rows: filtered.length });
  };

  const EmptyIcon: LucideIcon = SearchX;

  return (
    <div aria-labelledby="pharmacy-balance-title">
      <PageHeader
        icon={Boxes}
        title="Stock Balance"
        subtitle="What's on the shelves, what it's worth, and what needs attention"
        actions={
          <button
            type="button"
            onClick={exportCsv}
            disabled={!hydrated || filtered.length === 0}
            className={cn(brandBtn(), "h-10 px-4 text-[13.5px] disabled:opacity-50")}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
        }
      />
      <h2 id="pharmacy-balance-title" className="sr-only">
        Stock Balance
      </h2>

      {/* Balance summary */}
      <div className={cn(pharmacyCardCls, "mt-5 flex flex-wrap gap-3 p-4")}>
        <StatChip value={String(hydrated ? items.length : "—")} label="SKUs" />
        <StatChip value={String(hydrated ? units : "—")} label="Units on hand" />
        <StatChip value={hydrated ? formatZMW(value) : "—"} label="Total stock value" />
        <StatChip
          value={String(hydrated ? healthyCount : "—")}
          label="Healthy"
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <StatChip
          value={String(hydrated ? lowCount + outCount : "—")}
          label="Need attention"
          tone="text-amber-600 dark:text-amber-400"
        />
      </div>

      {/* Category breakdown + expiry watch */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <motion.section
          variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
          className={cn(pharmacyCardCls, "p-5 lg:col-span-3")}
          aria-labelledby="balance-by-category"
        >
          <h3 id="balance-by-category" className="text-[15px] font-bold tracking-tight">
            Balance by category
          </h3>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
            Share of total stock value
          </p>
          <ul className="mt-4 flex flex-col gap-3.5">
            {byCategory.map(({ name, units: catUnits, value: catValue, share }) => (
              <li key={name}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate font-semibold text-slate-700 dark:text-slate-200">
                    {name}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                    {catUnits} units · {formatZMW(catValue)}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
                  role="img"
                  aria-label={`${name}: ${Math.round(share * 100)}% of stock value`}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(share * 100, 2)}%` }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                  />
                </div>
              </li>
            ))}
            {byCategory.length === 0 && (
              <li className="py-3 text-center text-[13px] text-slate-500 dark:text-slate-400">
                No stock on the shelves yet.
              </li>
            )}
          </ul>
        </motion.section>

        <motion.section
          variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
          className={cn(pharmacyCardCls, "p-5 lg:col-span-2")}
          aria-labelledby="balance-expiry-watch"
        >
          <h3 id="balance-expiry-watch" className="text-[15px] font-bold tracking-tight">
            Expiry watch
          </h3>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
            Batches expiring within {EXPIRY_WATCH_DAYS} days
          </p>
          <ul className="mt-4 flex flex-col divide-y divide-slate-100 dark:divide-white/5">
            {expiryWatch.map(({ entry, days }) => (
              <li key={entry.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">
                    {entry.name}
                  </p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">
                    Batch {entry.batch} · {entry.qty} on hand
                  </p>
                </div>
                <span className="ml-auto shrink-0">
                  {days <= 0 ? (
                    <StatusPill status="out" label="Expired" />
                  ) : (
                    <StatusPill status="low" label={`${days} day${days === 1 ? "" : "s"}`} />
                  )}
                </span>
              </li>
            ))}
            {expiryWatch.length === 0 && (
              <li className="flex items-center gap-2 py-3 text-[13px] text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                Nothing expiring soon — clear runways.
              </li>
            )}
          </ul>
        </motion.section>
      </div>

      {/* Search + filters + sorting */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by product, category or batch…"
            aria-label="Search stock balance"
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-[13.5px] outline-none transition-[border-color,box-shadow] focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-[#0a1f16] dark:[&>option]:text-white"
        >
          <option value="all">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort balance table"
          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-[13.5px] outline-none transition-[border-color,box-shadow] focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-[#0a1f16] dark:[&>option]:text-white"
        >
          {SORTS.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <div role="radiogroup" aria-label="Filter by stock status" className="flex items-center gap-1.5">
          {FILTERS.map(({ id, label }) => {
            const active = filter === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setFilter(id)}
                className={cn(
                  "inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500",
                  active
                    ? "bg-emerald-600 text-white shadow-[0_6px_16px_-6px_rgba(16,185,129,0.7)]"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-emerald-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Balance table */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
        className={cn(pharmacyCardCls, "mt-5 overflow-hidden")}
      >
        {filtered.length === 0 ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
            <EmptyIcon className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
              No items match {query.trim() ? `"${query.trim()}"` : "this filter"}.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
                setCategory("all");
              }}
              className="text-[13px] font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Clear search & filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                  <th scope="col" className="px-5 py-3 font-semibold">Product</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Batch</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Expiry</th>
                  <th scope="col" className="px-3 py-3 font-semibold">On hand</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Unit price</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Stock value</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((entry) => {
                  const status = stockStatusOf(entry.qty, entry.reorderLevel);
                  const days = daysToExpiry(entry.expiry, now);
                  const coverPct =
                    entry.reorderLevel > 0
                      ? Math.min(100, Math.round((entry.qty / (entry.reorderLevel * 2)) * 100))
                      : entry.qty > 0
                        ? 100
                        : 0;
                  return (
                    <tr key={entry.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-white/5">
                      <td className="max-w-[240px] px-5 py-3">
                        <p className="truncate font-semibold text-slate-900 dark:text-white">{entry.name}</p>
                        <p className="text-[12px] text-slate-500 dark:text-slate-400">{entry.category}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-[12px] text-slate-500 dark:text-slate-400">
                        {entry.batch}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300">
                        <span className={cn(days <= 0 && "font-semibold text-rose-600 dark:text-rose-400")}>
                          {new Date(`${entry.expiry}T00:00:00`).toLocaleDateString("en-US", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="w-10 text-right font-bold tabular-nums">{entry.qty}</span>
                          <div
                            className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
                            role="img"
                            aria-label={`${entry.qty} on hand against reorder level ${entry.reorderLevel}`}
                          >
                            <div
                              className={cn(
                                "h-full rounded-full",
                                status === "healthy"
                                  ? "bg-emerald-500"
                                  : status === "low"
                                    ? "bg-amber-500"
                                    : "bg-rose-500"
                              )}
                              style={{ width: `${coverPct}%` }}
                            />
                          </div>
                          <span className="whitespace-nowrap text-[11.5px] text-slate-400 dark:text-slate-500">
                            reorder at {entry.reorderLevel}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {formatZMW(entry.unitPrice)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums">
                        {formatZMW(entry.qty * entry.unitPrice)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill
                          status={status}
                          label={status === "healthy" ? "Healthy" : status === "low" ? "Low" : "Out of stock"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-100 bg-slate-50/60 text-[12.5px] font-semibold text-slate-600 dark:border-white/5 dark:bg-white/5 dark:text-slate-300">
                  <td colSpan={4} className="px-5 py-3">
                    {filtered.length} item{filtered.length === 1 ? "" : "s"} listed
                  </td>
                  <td className="px-3 py-3 text-right font-semibold uppercase tracking-wide text-[11px] text-slate-400">
                    Filtered value
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums">
                    {formatZMW(filtered.reduce((acc, entry) => acc + entry.qty * entry.unitPrice, 0))}
                  </td>
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </motion.div>

      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-slate-400 dark:text-slate-500">
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
        Balance mirrors your Inventory adjustments · exports carry the filters applied above
      </p>
    </div>
  );
}

/** Local brand-button class (keeps this file free of extra imports). */
function brandBtn() {
  return "inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_8px_22px_-8px_rgba(16,185,129,0.65)] transition-shadow hover:shadow-[0_12px_28px_-8px_rgba(16,185,129,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500";
}
