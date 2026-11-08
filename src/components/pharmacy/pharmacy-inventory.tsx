"use client";

import { motion } from "framer-motion";
import {
  Minus,
  Package,
  PackageX,
  Plus,
  Search,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatZMW,
  loadInventory,
  resolveStoreId,
  saveInventory,
  type InventoryItem,
} from "@/components/pharmacy/pharmacy-data";
import {
  PageHeader,
  pharmacyCardCls,
  stockStatusOf,
  type StockStatus,
} from "@/components/pharmacy/pharmacy-shared";
import { recordAudit } from "@/lib/audit-log";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

type StockFilter = "all" | StockStatus;

const FILTERS: { id: StockFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "healthy", label: "Healthy" },
  { id: "low", label: "Low" },
  { id: "out", label: "Out of stock" },
];

function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-[128px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
      <p className="text-[18px] font-bold leading-none tracking-tight">{value}</p>
      <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PharmacyInventory({ storeId = "all" }: { storeId?: string }) {
  const { toast } = useToast();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
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
      setHydrated(true);
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // The table follows the sidebar's store view; edits persist for every store.
  const visible = useMemo(
    () =>
      storeId === "all"
        ? items
        : items.filter((entry) => resolveStoreId(entry) === storeId),
    [items, storeId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visible.filter((entry) => {
      const matchesQuery =
        !q ||
        entry.name.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q) ||
        entry.batch.toLowerCase().includes(q);
      const status = stockStatusOf(entry.qty, entry.reorderLevel);
      const matchesFilter = filter === "all" || status === filter;
      return matchesQuery && matchesFilter;
    });
  }, [visible, query, filter]);

  const units = visible.reduce((acc, entry) => acc + entry.qty, 0);
  const value = visible.reduce((acc, entry) => acc + entry.qty * entry.unitPrice, 0);
  const lowCount = visible.filter((entry) => stockStatusOf(entry.qty, entry.reorderLevel) !== "healthy").length;

  /** ±1 quantity adjustment, persisted like every console edit. */
  const adjustQty = (id: string, delta: number) => {
    if (!hydrated) return;
    const next = items.map((entry) =>
      entry.id === id ? { ...entry, qty: Math.max(0, entry.qty + delta) } : entry
    );
    const changed = next.find((entry) => entry.id === id);
    setItems(next);
    saveInventory(next);
    if (changed) {
      toast({
        title: `${changed.name} ${delta > 0 ? "+1" : "−1"}`,
        description: `${changed.qty} on the shelf now.`,
      });
      if (actor.email) {
        recordAudit({
          title: "Stock Adjusted",
          action: "Update",
          detail: `${changed.name} → ${changed.qty} units`,
          actor: actor.name,
          email: actor.email,
        });
      }
      void trackEvent("pharmacy_stock_adjusted", { item: changed.id, delta });
    }
  };

  const FilterIcon: LucideIcon = filter === "out" ? PackageX : SearchX;

  return (
    <div aria-labelledby="pharmacy-inventory-title">
      <PageHeader
        icon={Package}
        title="Inventory"
        subtitle="Stock on hand across your shelves"
      />
      <h2 id="pharmacy-inventory-title" className="sr-only">
        Inventory
      </h2>

      {/* Stats */}
      <div className={cn(pharmacyCardCls, "mt-5 flex flex-wrap gap-3 p-4")}>
        <StatChip value={String(hydrated ? items.length : "—")} label="SKUs" />
        <StatChip value={String(hydrated ? units : "—")} label="Units on hand" />
        <StatChip value={hydrated ? formatZMW(value) : "—"} label="Inventory value" />
        <StatChip value={String(hydrated ? lowCount : "—")} label="Need attention" />
      </div>

      {/* Search + filters */}
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
            aria-label="Search inventory"
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
        <div
          role="radiogroup"
          aria-label="Filter by stock status"
          className="flex items-center gap-1.5"
        >
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
                  "inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                  active
                    ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className={cn(pharmacyCardCls, "mt-5 overflow-hidden")}>
        {filtered.length === 0 ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
            <FilterIcon className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
              No items match {query.trim() ? `"${query.trim()}"` : "this filter"}.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="text-[13px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
            >
              Clear search & filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                  <th scope="col" className="px-5 py-3 font-semibold">Product</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Batch</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Expiry</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Qty</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Adjust</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Unit price</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((entry) => {
                  const status = stockStatusOf(entry.qty, entry.reorderLevel);
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
                        {new Date(entry.expiry).toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">{entry.qty}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Reduce ${entry.name} by one`}
                            disabled={entry.qty === 0}
                            onClick={() => adjustQty(entry.id, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Increase ${entry.name} by one`}
                            onClick={() => adjustQty(entry.id, +1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-purple-50 hover:text-purple-600 dark:border-white/10 dark:text-slate-300 dark:hover:bg-purple-500/15"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {formatZMW(entry.unitPrice)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
                            status === "healthy" &&
                              "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
                            status === "low" &&
                              "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
                            status === "out" &&
                              "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                          )}
                        >
                          {status === "healthy" ? "Healthy" : status === "low" ? "Low" : "Out of stock"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      <p className="mt-3 text-[12px] text-slate-400 dark:text-slate-500">
        Showing {filtered.length} of {visible.length} items in this store view · quantities persist on
        this device
      </p>
    </div>
  );
}
