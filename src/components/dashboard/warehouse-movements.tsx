"use client";

import { ClipboardEdit, Search, SearchX } from "lucide-react";
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
import { listNetworkInventory } from "@/lib/cloud/pharmacy-inventory";
import { listNetworkPharmacySales } from "@/lib/cloud/pharmacy-sales";
import {
  loadWarehouseItems,
  loadWarehouseMovements,
  recordWarehouseMovement,
  WAREHOUSE_NAME,
  type WarehouseItem,
  type WarehouseMovement,
  type WarehouseMovementType,
} from "@/lib/warehouse";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Pulse Stock Movements — the warehouse ledger. Every quantity change  */
/* is recorded here (the Warehouse Catalogue is read-only), so the      */
/* ledger and the shelves always agree.                                 */
/* ------------------------------------------------------------------ */

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";
const inputCls =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[13.5px] outline-none placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white";

const TYPE_META: Record<WarehouseMovementType, { label: string; hint: string }> = {
  receipt: { label: "Receipt", hint: "Goods arriving at the warehouse" },
  issue: { label: "Issue", hint: "Stock leaving for a pharmacy or write-off" },
  transfer: { label: "Transfer", hint: "Stock issued out to the network" },
  adjustment: { label: "Adjustment", hint: "Corrections found during a stock count (signed)" },
  return: { label: "Return", hint: "Goods returned to the warehouse" },
};

const REASONS: Record<WarehouseMovementType, string[]> = {
  receipt: ["Supplier delivery", "Central hub restock", "Other"],
  issue: ["Issued to pharmacy", "Damaged / broken", "Expired — write-off", "Other"],
  transfer: ["Store request fulfilment", "Network issue", "Other"],
  adjustment: ["Stock count correction", "Damaged — write-off", "Expired — write-off", "Theft / loss", "Other"],
  return: ["Pharmacy return — restock", "Supplier return", "Other"],
};

const FILTERS: { id: WarehouseMovementType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "receipt", label: "Receipts" },
  { id: "issue", label: "Issues" },
  { id: "transfer", label: "Transfers" },
  { id: "adjustment", label: "Adjustments" },
  { id: "return", label: "Returns" },
];

export function WarehouseMovements({ actor }: { actor: { name: string; email: string } }) {
  const { toast } = useToast();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [movements, setMovements] = useState<WarehouseMovement[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WarehouseMovementType | "all">("all");
  const [recordOpen, setRecordOpen] = useState(false);
  const [form, setForm] = useState<{ type: WarehouseMovementType; itemId: string; qty: string; reason: string; note: string; destination: string; destinationName: string }>({
    type: "receipt",
    itemId: "",
    qty: "",
    reason: REASONS.receipt[0],
    note: "",
    destination: "",
    destinationName: "",
  });
  const [pharmacies, setPharmacies] = useState<{ id: string; name: string }[]>([]);

  const reload = () => {
    setItems(loadWarehouseItems());
    setMovements(loadWarehouseMovements());
  };

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      reload();
      setHydrated(true);
    });
    // Registered pharmacies for the issue/transfer destination dropdown:
    // network inventory directory, then the sales directory, then this
    // console's local pharmacy registry — the picker is always a dropdown.
    void (async () => {
      const found = new Map<string, { id: string; name: string }>();
      try {
        const page = await listNetworkInventory(1);
        for (const pharmacy of page.pharmacies) found.set(pharmacy.name.toLowerCase(), pharmacy);
      } catch {
        /* try the sales directory next */
      }
      if (found.size === 0) {
        try {
          const page = await listNetworkPharmacySales({ limit: 1 });
          for (const pharmacy of page.pharmacies) found.set(pharmacy.name.toLowerCase(), pharmacy);
        } catch {
          /* fall through to the local registry */
        }
      }
      if (found.size === 0) {
        try {
          const raw: unknown = JSON.parse(window.localStorage.getItem("pulse.pharmacies.v1") ?? "[]");
          if (Array.isArray(raw)) {
            for (const entry of raw as { id?: string; name?: string }[]) {
              if (entry?.name) {
                found.set(entry.name.toLowerCase(), { id: entry.id ?? entry.name, name: entry.name });
              }
            }
          }
        } catch {
          /* no local registry either — dropdown shows its empty state */
        }
      }
      setPharmacies([...found.values()].sort((a, b) => a.name.localeCompare(b.name)));
    })();
    return () => cancelAnimationFrame(raf);
  }, []);

  const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week = movements.filter((entry) => entry.at >= weekCutoff);
  const unitsIn = week.filter((entry) => entry.qty > 0).reduce((acc, entry) => acc + entry.qty, 0);
  const unitsOut = week.filter((entry) => entry.qty < 0).reduce((acc, entry) => acc + Math.abs(entry.qty), 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movements
      .filter((entry) => filter === "all" || entry.type === filter)
      .filter(
        (entry) =>
          !q ||
          entry.productName.toLowerCase().includes(q) ||
          entry.batch.toLowerCase().includes(q) ||
          entry.reason.toLowerCase().includes(q) ||
          (entry.destinationPharmacyName ?? "").toLowerCase().includes(q) ||
          entry.id.toLowerCase().includes(q)
      )
      .sort((a, b) => b.at - a.at);
  }, [movements, filter, query]);

  const needsDestination = form.type === "issue" || form.type === "transfer";

  const submit = () => {
    const qty = Number(form.qty);
    if (!form.itemId || !Number.isFinite(qty) || qty === 0) {
      toast({ title: "Almost there", description: "Pick a product and enter a quantity." });
      return;
    }
    const destinationName = (form.destinationName || form.destination).trim();
    if (needsDestination && destinationName.length < 2) {
      toast({ title: "Where is it going?", description: "Pick the registered pharmacy this stock is leaving for." });
      return;
    }
    const destination = pharmacies.find((pharmacy) => pharmacy.name === destinationName);
    const movement = recordWarehouseMovement({
      type: form.type,
      itemId: form.itemId,
      qty,
      reason: form.reason,
      note: form.note.trim() || undefined,
      ...(needsDestination
        ? {
            destinationPharmacyName: destinationName,
            ...(destination ? { destinationPharmacyId: destination.id } : {}),
          }
        : {}),
      actor,
    });
    if (!movement) {
      toast({ title: "Not enough on the shelf", description: "That movement would take the warehouse below zero." });
      return;
    }
    reload();
    setRecordOpen(false);
    setForm({ type: "receipt", itemId: "", qty: "", reason: REASONS.receipt[0], note: "", destination: "", destinationName: "" });
    toast({
      title: "Movement recorded",
      description: `${movement.id} · ${movement.productName} ${movement.qty > 0 ? "+" : ""}${movement.qty}${movement.destinationPharmacyName ? ` → ${movement.destinationPharmacyName}` : ""} — shelves updated.`,
    });
  };

  return (
    <div className="space-y-6" data-tour="pulse-warehouse-movements">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-bold tracking-tight text-slate-900 dark:text-white">Stock Movement</h2>
          <p className="mt-1 text-[14px] text-slate-500 dark:text-slate-400">
            Every receipt, issue, transfer and quantity adjustment at {WAREHOUSE_NAME} — one auditable ledger.
          </p>
        </div>
        <button type="button" onClick={() => setRecordOpen(true)} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500">
          <ClipboardEdit className="h-4 w-4" aria-hidden="true" /> Record movement
        </button>
      </div>

      <div className={cn(cardCls, "flex items-center gap-3 px-5 py-4")}>
        <p className="text-[13.5px] leading-snug text-slate-600 dark:text-slate-300">
          <strong className="text-slate-900 dark:text-white">Quantities change here.</strong>{" "}
          The Warehouse Catalogue is the shelf view of this same stock — record a movement and the shelf updates instantly, and warehouse receives land here as receipts.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-5 2xl:grid-cols-4">
        {[
          { value: hydrated ? String(week.length) : "—", label: "Movements · 7 days" },
          { value: hydrated ? `+${unitsIn}` : "—", label: "Units in · 7 days" },
          { value: hydrated ? `−${unitsOut}` : "—", label: "Units out · 7 days" },
          { value: hydrated ? String(unitsIn - unitsOut) : "—", label: "Net shelf change · 7 days" },
        ].map((card) => (
          <div key={card.label} className={cn(cardCls, "p-5")}>
            <p className="text-2xl font-bold leading-none tracking-tight">{card.value}</p>
            <p className="mt-2 text-[13px] font-medium text-slate-500 dark:text-slate-400">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block w-full max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by product, batch, reason or reference…" aria-label="Search movements" className={cn(inputCls, "pl-9")} />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
          {FILTERS.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={cn("inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-colors", filter === id ? "bg-purple-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={cn(cardCls, "overflow-hidden")}>
        {visible.length === 0 ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center gap-2.5 px-4 py-10 text-center">
            <SearchX className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
              {movements.length === 0 ? "No stock movements recorded yet — record one to start the ledger." : "No movements match this view."}
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-slate-100 dark:divide-white/5">
            {visible.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className={cn("rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize", entry.qty > 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300")}>
                  {TYPE_META[entry.type].label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">
                    {entry.productName} <span className="font-mono text-[12px] font-normal text-slate-400">{entry.id}</span>
                  </p>
                  <p className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">
                    {entry.batch} · {entry.reason}
                    {entry.destinationPharmacyName ? (
                      <span className="font-semibold text-purple-600 dark:text-purple-300"> → {entry.destinationPharmacyName}</span>
                    ) : null}
                    {entry.note ? ` · ${entry.note}` : ""} · {entry.actor.name}
                  </p>
                </div>
                <p className={cn("text-[14px] font-bold tabular-nums", entry.qty > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                  {entry.qty > 0 ? "+" : ""}{entry.qty}
                </p>
                <time className="whitespace-nowrap text-[12.5px] text-slate-500 dark:text-slate-400">
                  {new Date(entry.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </time>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="text-[12px] text-slate-400 dark:text-slate-500">
        Showing {visible.length} of {movements.length} movements at the warehouse · the ledger persists on this device
      </p>

      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="rounded-2xl p-6 sm:max-w-[520px]">
          <DialogHeader className="space-y-1.5 text-left sm:text-left">
            <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">Record movement</DialogTitle>
            <DialogDescription className="text-[13.5px] text-slate-500 dark:text-slate-400">
              One entry, two updates: the ledger and the warehouse shelf move together.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="wm-type" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Type</label>
                <select id="wm-type" value={form.type} onChange={(e) => { const type = e.target.value as WarehouseMovementType; setForm((f) => ({ ...f, type, reason: REASONS[type][0] })); }} className={inputCls}>
                  {(Object.keys(TYPE_META) as WarehouseMovementType[]).map((type) => (
                    <option key={type} value={type}>{TYPE_META[type].label} — {TYPE_META[type].hint}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="wm-item" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Product</label>
                <select id="wm-item" value={form.itemId} onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))} className={inputCls}>
                  <option value="">Select a product…</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>{item.name} · {item.batch} ({item.qty} on hand)</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="wm-qty" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Quantity {form.type === "adjustment" ? "(signed)" : ""}</label>
                <input id="wm-qty" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} type="number" placeholder="e.g. 40" className={inputCls} />
              </div>
              <div>
                <label htmlFor="wm-reason" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Reason</label>
                <select id="wm-reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className={inputCls}>
                  {REASONS[form.type].map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </div>
              {(form.type === "issue" || form.type === "transfer") && (
                <div className="sm:col-span-2">
                  <label htmlFor="wm-destination" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                    Destination pharmacy <span className="font-normal text-slate-400">— where this stock is going</span>
                  </label>
                  <select
                    id="wm-destination"
                    value={form.destinationName}
                    onChange={(e) => setForm((f) => ({ ...f, destinationName: e.target.value, destination: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">
                      {pharmacies.length > 0 ? "Select the receiving pharmacy…" : "No registered pharmacies found yet"}
                    </option>
                    {pharmacies.map((pharmacy) => (
                      <option key={pharmacy.id} value={pharmacy.name}>{pharmacy.name}</option>
                    ))}
                  </select>
                  {pharmacies.length === 0 && (
                    <p className="mt-1.5 text-[12px] text-slate-400 dark:text-slate-500">
                      Registered pharmacies appear here once they join the network.
                    </p>
                  )}
                </div>
              )}
              <div className="sm:col-span-2">
                <label htmlFor="wm-note" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Note (optional)</label>
                <input id="wm-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Reference, delivery note, anything for the audit trail" className={inputCls} />
              </div>
            </div>
            {items.length === 0 && (
              <p role="alert" className="text-[12.5px] font-medium text-amber-600 dark:text-amber-400">
                The warehouse is empty — receive stock in Warehouse Catalogue first.
              </p>
            )}
          </div>
          <DialogFooter className="mt-2 gap-2">
            <button type="button" onClick={() => setRecordOpen(false)} className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">Cancel</button>
            <button type="button" onClick={submit} className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500">
              <ClipboardEdit className="h-4 w-4" aria-hidden="true" /> Record movement
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
