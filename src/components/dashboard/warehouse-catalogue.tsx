"use client";

import { motion } from "framer-motion";
import { PackagePlus, Search, Warehouse } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  loadWarehouseItems,
  loadWarehouseMovements,
  nextWarehouseMovementId,
  saveWarehouseItems,
  saveWarehouseMovements,
  WAREHOUSE_NAME,
  type WarehouseItem,
} from "@/lib/warehouse";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Warehouse Catalogue — Pulse Central Warehouse shelves. Quantities    */
/* share one store with the Stock Movements ledger (src/lib/warehouse)  */
/* so this page and Stock Movements always agree.                       */
/* ------------------------------------------------------------------ */

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";
const inputCls =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[13.5px] outline-none placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white";

export function WarehouseCatalogue() {
  const { toast } = useToast();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ name: "", category: "General", qty: "", unitPrice: "", batch: "", expiry: "" });

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setItems(loadWarehouseItems());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const persist = (next: WarehouseItem[]) => {
    setItems(next);
    saveWarehouseItems(next);
  };

  const recordMovement = (item: WarehouseItem, qty: number, reason: string) => {
    const movements = loadWarehouseMovements();
    saveWarehouseMovements([
      {
        id: nextWarehouseMovementId(movements),
        at: Date.now(),
        type: qty >= 0 ? ("receipt" as const) : ("adjustment" as const),
        itemId: item.id,
        productName: item.name,
        batch: item.batch,
        qty,
        reason,
        actor: { name: "Pulse warehouse", email: "" },
      },
      ...movements,
    ]);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((item) => !q || item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, query]);

  const units = items.reduce((acc, item) => acc + item.qty, 0);
  const value = items.reduce((acc, item) => acc + item.qty * item.unitPrice, 0);
  const low = items.filter((item) => item.qty <= item.reorderLevel);

  const addItem = () => {
    const qty = Math.max(0, Math.round(Number(form.qty) || 0));
    if (form.name.trim().length < 2 || qty < 1) {
      toast({ title: "Almost there", description: "Give the product a name and at least one unit." });
      return;
    }
    const name = form.name.trim();
    const batch = form.batch.trim() || `WH-${new Date().getFullYear()}`;
    const existing = items.find(
      (row) => row.name.toLowerCase() === name.toLowerCase() && row.batch === batch
    );
    const item: WarehouseItem = existing ?? {
      id: `wh-${Date.now().toString(36)}`,
      name,
      category: form.category.trim() || "General",
      batch,
      expiry: form.expiry || new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      qty,
      reorderLevel: Math.max(1, Math.round(qty * 0.25)),
      unitPrice: Math.max(0, Number(form.unitPrice) || 0),
    };
    persist(
      existing
        ? items.map((row) => (row.id === item.id ? { ...row, qty: row.qty + qty } : row))
        : [item, ...items]
    );
    recordMovement(item, qty, "Supplier delivery");
    setForm({ name: "", category: "General", qty: "", unitPrice: "", batch: "", expiry: "" });
    setReceiveOpen(false);
    toast({ title: "Added to warehouse", description: `${name} × ${qty} is on the hub shelves — receipt recorded in Stock Movements.` });
  };

  return (
    <div className="space-y-7" data-tour="pulse-warehouse">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-bold tracking-tight text-slate-900 dark:text-white">Warehouse Catalogue</h2>
          <p className="mt-1 text-[14px] text-slate-500 dark:text-slate-400">
            Stock held at {WAREHOUSE_NAME} — the hub Pulse issues to the network from.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReceiveOpen(true)}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-shadow hover:shadow-[0_12px_26px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
        >
          <PackagePlus className="h-4 w-4" aria-hidden="true" />
          Receive into warehouse
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-4">
        {[
          { label: "Products", value: hydrated ? String(items.length) : "—", desc: "Lines in the warehouse" },
          { label: "Units on hand", value: hydrated ? units.toLocaleString() : "—", desc: "Across every batch" },
          { label: "Stock value", value: hydrated ? `ZMW ${Math.round(value).toLocaleString()}` : "—", desc: "At unit cost" },
          { label: "Low stock", value: hydrated ? String(low.length) : "—", desc: "At or below reorder level" },
        ].map((card) => (
          <div key={card.label} className={cn(cardCls, "p-5")}>
            <p className="text-2xl font-bold leading-none tracking-tight">{card.value}</p>
            <p className="mt-2 text-[15px] font-semibold leading-none">{card.label}</p>
            <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">{card.desc}</p>
          </div>
        ))}
      </div>

      <div className={cn(cardCls, "overflow-hidden")}>
        <div className="flex flex-wrap items-center gap-3 p-5 pb-3">
          <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">On the shelves</h3>
          <label className="relative ml-auto block w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search warehouse…" aria-label="Search warehouse" className={cn(inputCls, "pl-9")} />
          </label>
        </div>
        {filtered.length === 0 ? (
          <p className="px-5 pb-6 text-[13.5px] text-slate-500 dark:text-slate-400">
            {items.length === 0 ? "The warehouse is empty — receive your first stock above." : "Nothing matches that search."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[13.5px]">
              <thead>
                <tr className="border-y border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                  <th className="px-5 py-3 font-semibold">Product</th>
                  <th className="px-3 py-3 font-semibold">Batch</th>
                  <th className="px-3 py-3 font-semibold">Expiry</th>
                  <th className="px-3 py-3 text-right font-semibold">Qty</th>
                  <th className="px-5 py-3 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-900 dark:text-white">{item.name}</p>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">{item.category}</p>
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px]">{item.batch}</td>
                    <td className="px-3 py-3">{item.expiry}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums">
                      {item.qty}
                      {item.qty <= item.reorderLevel && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Low</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">ZMW {Math.round(item.qty * item.unitPrice).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[12px] text-slate-400 dark:text-slate-500">
        Warehouse quantities are read-only here — adjustments are recorded in Stock Movement so the
        ledger stays auditable. Pharmacy shelves live under Pharmacies Inventory.
      </motion.p>

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="rounded-2xl p-6 sm:max-w-[520px]">
          <DialogHeader className="space-y-1.5 text-left sm:text-left">
            <DialogTitle className="flex items-center gap-2 text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
              <Warehouse className="h-5 w-5 text-purple-600" aria-hidden="true" />
              Receive into warehouse
            </DialogTitle>
            <DialogDescription className="text-[13.5px] text-slate-500 dark:text-slate-400">
              Book stock into {WAREHOUSE_NAME}. It lands on the hub shelves immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-4">
            <div>
              <label htmlFor="wh-name" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Product name</label>
              <input id="wh-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Amoxicillin 500mg" className={inputCls} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="wh-category" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Category</label>
                <input id="wh-category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="General" className={inputCls} />
              </div>
              <div>
                <label htmlFor="wh-batch" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Batch</label>
                <input id="wh-batch" value={form.batch} onChange={(e) => setForm((f) => ({ ...f, batch: e.target.value }))} placeholder="e.g. WH-2026-04" className={inputCls} />
              </div>
              <div>
                <label htmlFor="wh-qty" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Quantity</label>
                <input id="wh-qty" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} type="number" min={1} placeholder="e.g. 500" className={inputCls} />
              </div>
              <div>
                <label htmlFor="wh-cost" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Unit cost (ZMW)</label>
                <input id="wh-cost" value={form.unitPrice} onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))} type="number" min={0} placeholder="e.g. 12.50" className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="wh-expiry" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Expiry date</label>
                <input id="wh-expiry" value={form.expiry} onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))} type="date" className={inputCls} />
              </div>
            </div>
          </div>
          <DialogFooter className="mt-2 gap-2">
            <button type="button" onClick={() => setReceiveOpen(false)} className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">
              Cancel
            </button>
            <button type="button" onClick={addItem} className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500">
              <PackagePlus className="h-4 w-4" aria-hidden="true" />
              Add to warehouse
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
