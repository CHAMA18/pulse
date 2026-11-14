"use client";

import { Building2, RefreshCw, Search, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listNetworkInventory,
  type NetworkInventoryItem,
} from "@/lib/cloud/pharmacy-inventory";
import { loadCachedRead, saveCachedRead } from "@/lib/offline/read-cache";
import {
  duniyaUnitPrice,
  formatZmw,
  impliedCostPrice,
  normaliseMarkup,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Pharmacies Inventory — every registered pharmacy's shelves, grouped  */
/* pharmacy → outlet (store) → product, from the network stock feed.    */
/* Pharmacies that have never synced appear with an honest empty state. */
/* ------------------------------------------------------------------ */

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";

const NETWORK_INVENTORY_CACHE_KEY = "dashboard-network-inventory";

type CachedInventoryPage = {
  items: NetworkInventoryItem[];
  pharmacies: { id: string; name: string }[];
};

type OutletGroup = { key: string; name: string; items: NetworkInventoryItem[] };
type PharmacyGroup = {
  id: string;
  name: string;
  outlets: OutletGroup[];
  skus: number;
  units: number;
  /** Duniya value: cost + the standard markup. */
  value: number;
  retailValue: number;
};

export function PharmaciesInventory() {
  const [items, setItems] = useState<NetworkInventoryItem[]>([]);
  const [directory, setDirectory] = useState<{ id: string; name: string }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [query, setQuery] = useState("");
  const [pharmacyFilter, setPharmacyFilter] = useState("all");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const page = await listNetworkInventory(1000);
      setItems(page.items);
      setDirectory(page.pharmacies);
      setState("ready");
      saveCachedRead<CachedInventoryPage>(NETWORK_INVENTORY_CACHE_KEY, page);
    } catch {
      // Offline or rules — fall back to the last synced network picture.
      const cached = loadCachedRead<CachedInventoryPage>(NETWORK_INVENTORY_CACHE_KEY);
      if (cached) {
        setItems(cached.data.items);
        setDirectory(cached.data.pharmacies);
        setState("ready");
      } else {
        setState("failed");
      }
    }
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const groups = useMemo<PharmacyGroup[]>(() => {
    const byPharmacy = new Map<string, PharmacyGroup>();
    for (const pharmacy of directory) {
      byPharmacy.set(pharmacy.id, { id: pharmacy.id, name: pharmacy.name, outlets: [], skus: 0, units: 0, value: 0, retailValue: 0 });
    }
    const q = query.trim().toLowerCase();
    for (const item of items) {
      if (q && !item.name.toLowerCase().includes(q) && !item.pharmacyName.toLowerCase().includes(q)) continue;
      const group = byPharmacy.get(item.pharmacyId) ?? {
        id: item.pharmacyId,
        name: item.pharmacyName,
        outlets: [],
        skus: 0,
        units: 0,
        value: 0,
        retailValue: 0,
      };
      const outletName = item.storeName?.trim() || item.storeId || "Main store";
      let outlet = group.outlets.find((entry) => entry.key === (item.storeId ?? outletName));
      if (!outlet) {
        outlet = { key: item.storeId ?? outletName, name: outletName, items: [] };
        group.outlets.push(outlet);
      }
      outlet.items.push(item);
      const markup = normaliseMarkup(item.markupPercent);
      const cost = item.costPrice ?? impliedCostPrice(item.unitPrice, markup);
      group.skus += 1;
      group.units += item.qty;
      group.value += item.qty * duniyaUnitPrice(cost, markup);
      group.retailValue += item.qty * item.unitPrice;
      byPharmacy.set(item.pharmacyId, group);
    }
    return [...byPharmacy.values()]
      .filter((group) => pharmacyFilter === "all" || group.id === pharmacyFilter)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }, [items, directory, query, pharmacyFilter]);

  const totals = useMemo(
    () => ({
      pharmacies: directory.length,
      outlets: new Set(items.map((item) => `${item.pharmacyId}:${item.storeId ?? ""}`)).size,
      skus: items.length,
      units: items.reduce((acc, item) => acc + item.qty, 0),
      value: items.reduce((acc, item) => {
        const markup = normaliseMarkup(item.markupPercent);
        const cost = item.costPrice ?? impliedCostPrice(item.unitPrice, markup);
        return acc + item.qty * duniyaUnitPrice(cost, markup);
      }, 0),
      retail: items.reduce((acc, item) => acc + item.qty * item.unitPrice, 0),
    }),
    [items, directory]
  );

  return (
    <div className="space-y-7" data-tour="pulse-pharmacies-inventory">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-bold tracking-tight text-slate-900 dark:text-white">Pharmacies Inventory</h2>
          <p className="mt-1 text-[14px] text-slate-500 dark:text-slate-400">
            Every product on every registered pharmacy&apos;s shelves — grouped by pharmacy and outlet.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 px-4 text-[13.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-4">
        {[
          { label: "Registered pharmacies", value: state === "ready" ? String(totals.pharmacies) : "—", desc: "On the Pulse network" },
          { label: "Outlets", value: state === "ready" ? String(totals.outlets) : "—", desc: "Stores reporting stock" },
          { label: "Products listed", value: state === "ready" ? totals.skus.toLocaleString() : "—", desc: "Shelf lines across the network" },
          { label: "Network Duniya value", value: state === "ready" ? formatZmw(totals.value) : "—", desc: `${totals.units.toLocaleString()} units · ${formatZmw(totals.retail)} retail` },
        ].map((card) => (
          <div key={card.label} className={cn(cardCls, "p-5")}>
            <p className="text-2xl font-bold leading-none tracking-tight">{card.value}</p>
            <p className="mt-2 text-[15px] font-semibold leading-none">{card.label}</p>
            <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">{card.desc}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={pharmacyFilter} onChange={(e) => setPharmacyFilter(e.target.value)} aria-label="Filter by pharmacy" className="h-10 rounded-md border border-slate-200 bg-white px-3 text-[13.5px] dark:border-white/10 dark:bg-white/5 dark:text-white">
          <option value="all">All pharmacies</option>
          {directory.map((pharmacy) => (
            <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</option>
          ))}
        </select>
        <label className="relative block w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products or pharmacies…" aria-label="Search inventory" className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] outline-none placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white" />
        </label>
      </div>

      {state === "failed" ? (
        <div className={cn(cardCls, "p-8 text-center")}>
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">Network inventory is unavailable</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-slate-500 dark:text-slate-400">
            The live shelves feed needs an active Pulse console session. Check your connection, then Refresh to try again.
          </p>
        </div>
      ) : state === "loading" ? (
        <div className={cn(cardCls, "flex min-h-[180px] flex-col items-center justify-center gap-2 p-8 text-center")} aria-busy="true">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" aria-hidden="true" />
          <p className="text-[13.5px] text-slate-500 dark:text-slate-400">Loading every pharmacy&apos;s shelves…</p>
        </div>
      ) : groups.length === 0 ? (
        <div className={cn(cardCls, "p-8 text-center")}>
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">No pharmacies registered yet</p>
          <p className="mt-1.5 text-[13.5px] text-slate-500 dark:text-slate-400">Registered pharmacies and their stock will appear here.</p>
        </div>
      ) : (
        groups.map((pharmacy) => (
          <section key={pharmacy.id} className={cn(cardCls, "overflow-hidden")} aria-label={pharmacy.name}>
            <header className="flex flex-wrap items-center gap-3 px-5 pt-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[17px] font-bold text-slate-900 dark:text-white">{pharmacy.name}</h3>
                <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
                  {pharmacy.outlets.length} outlet{pharmacy.outlets.length === 1 ? "" : "s"} · {pharmacy.skus} products · {pharmacy.units.toLocaleString()} units
                </p>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-bold tabular-nums text-purple-700 dark:text-purple-300">{formatZmw(pharmacy.value)}</p>
                <p className="text-[11.5px] text-slate-400">{formatZmw(pharmacy.retailValue)} retail</p>
              </div>
            </header>
            {pharmacy.outlets.length === 0 ? (
              <p className="px-5 py-5 text-[13.5px] text-slate-500 dark:text-slate-400">
                No stock synced yet — this pharmacy&apos;s shelves will appear after its next sign-in or sale.
              </p>
            ) : (
              pharmacy.outlets.map((outlet) => (
                <div key={outlet.key} className="px-5 pb-5 pt-4">
                  <p className="flex items-center gap-2 text-[13px] font-bold text-slate-700 dark:text-slate-200">
                    <Store className="h-4 w-4 text-purple-500" aria-hidden="true" /> {outlet.name}
                    <span className="font-medium text-slate-400">{outlet.items.length} products</span>
                  </p>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[860px] text-left text-[13.5px]">
                      <thead>
                        <tr className="border-y border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                          <th className="py-2.5 pr-3 font-semibold">Product</th>
                          <th className="px-3 py-2.5 font-semibold">Batch</th>
                          <th className="px-3 py-2.5 font-semibold">Expiry</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Duniya</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Retail</th>
                          <th className="py-2.5 pl-3 text-right font-semibold">Duniya value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {outlet.items.map((item) => {
                          const markup = normaliseMarkup(item.markupPercent);
                          const cost = item.costPrice ?? impliedCostPrice(item.unitPrice, markup);
                          const duniya = duniyaUnitPrice(cost, markup);
                          return (
                          <tr key={item.docId}>
                            <td className="py-2.5 pr-3">
                              <span className="font-semibold text-slate-900 dark:text-white">{item.name}</span>
                              <span className="block text-[12px] text-slate-500 dark:text-slate-400">{item.category}</span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[12px]">{item.batch || "—"}</td>
                            <td className="px-3 py-2.5">{item.expiry || "—"}</td>
                            <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                              {item.qty}
                              {item.qty <= 0 ? (
                                <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Out</span>
                              ) : item.qty <= item.reorderLevel ? (
                                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Low</span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatZmw(cost)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-purple-700 dark:text-purple-300">{formatZmw(duniya)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{formatZmw(item.unitPrice)}</td>
                            <td className="py-2.5 pl-3 text-right tabular-nums">{formatZmw(item.qty * duniya)}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </section>
        ))
      )}
    </div>
  );
}
