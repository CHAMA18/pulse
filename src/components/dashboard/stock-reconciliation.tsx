"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
  Search,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  getPharmacyReconciliation,
  listPharmacyReconciliations,
  savePharmacyReconciliation,
  type ReconciliationRecord,
  type ReconciliationSummary,
} from "@/lib/cloud/stock-requests";
import {
  listNetworkInventory,
  type NetworkInventoryItem,
} from "@/lib/cloud/pharmacy-inventory";
import {
  auditSchedule,
  computeReconciliation,
  RECONCILIATION_CADENCE_DAYS,
  type ReconciliationLineInput,
} from "@/lib/stock-reconciliation";
import { impliedCostPrice, normaliseMarkup, formatZmw } from "@/lib/pricing";
import { formatCachedAt, loadCachedRead, saveCachedRead } from "@/lib/offline/read-cache";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/* Stock Reconciliation — two-week physical counts                     */
/* ------------------------------------------------------------------ */

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";
const inputCls =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[13.5px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white";

const CACHE_KEY = "dashboard-stock-reconciliations";

type CachedPage = {
  history: ReconciliationSummary[];
  items: NetworkInventoryItem[];
  pharmacies: { id: string; name: string }[];
};

type ReconciliationFilter = "all" | "balanced" | "variance";

function dateOf(value?: number): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function scheduleLabel(summary: ReconciliationSummary | undefined, now = Date.now()) {
  const schedule = auditSchedule(summary?.completedAtMs ?? null, now);
  if (schedule.status === "never") return { label: "Never counted", tone: "text-rose-600 dark:text-rose-400" };
  if (schedule.status === "overdue" || (schedule.status === "due" && (schedule.daysUntilDue ?? 1) <= 0)) {
    return { label: "Due now", tone: "text-amber-600 dark:text-amber-400" };
  }
  if (schedule.daysUntilDue !== null && schedule.daysUntilDue <= 3) {
    return { label: `Due in ${schedule.daysUntilDue}d`, tone: "text-amber-600 dark:text-amber-400" };
  }
  return { label: `Due ${dateOf(schedule.nextDueAt ?? undefined)}`, tone: "text-slate-500 dark:text-slate-400" };
}

function countTone(variance: number): string {
  if (variance < 0) return "text-rose-600 dark:text-rose-400";
  if (variance > 0) return "text-emerald-600 dark:text-emerald-400";
  return "text-slate-500 dark:text-slate-400";
}

/* ------------------------------------------------------------------ */
/* Start a physical count                                              */
/* ------------------------------------------------------------------ */

function StartAuditDialog({
  items,
  pharmacies,
  initialPharmacyId,
  onClose,
  onSaved,
}: {
  items: NetworkInventoryItem[];
  pharmacies: { id: string; name: string }[];
  initialPharmacyId?: string | null;
  onClose: () => void;
  onSaved: (summary: ReconciliationSummary) => void;
}) {
  const [pharmacyId, setPharmacyId] = useState(
    () =>
      (initialPharmacyId && pharmacies.some((entry) => entry.id === initialPharmacyId)
        ? initialPharmacyId
        : pharmacies[0]?.id) ?? ""
  );
  const [storeId, setStoreId] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stores = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.pharmacyId !== pharmacyId) continue;
      const key = item.storeId ?? item.storeName ?? "st-main";
      map.set(key, item.storeName?.trim() || key || "Main store");
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [items, pharmacyId]);

  useEffect(() => {
    if (stores.length > 0 && !stores.some((store) => store.id === storeId)) {
      setStoreId(stores[0].id);
    }
    if (stores.length === 0 && storeId) setStoreId("");
  }, [stores, storeId]);

  const lines = useMemo(
    () =>
      items.filter(
        (item) =>
          item.pharmacyId === pharmacyId &&
          (item.storeId ?? item.storeName ?? "st-main") === storeId
      ),
    [items, pharmacyId, storeId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter(
      (line) =>
        !q ||
        line.name.toLowerCase().includes(q) ||
        (line.batch ?? "").toLowerCase().includes(q) ||
        (line.category ?? "").toLowerCase().includes(q)
    );
  }, [lines, query]);

  const hasCounts = Object.keys(counts).length > 0;

  const preview = useMemo(() => {
    const input: ReconciliationLineInput[] = lines.map((item) => ({
      itemId: item.docId,
      productId: item.productId,
      name: item.name,
      category: item.category,
      batch: item.batch,
      expiry: item.expiry,
      storeId: item.storeId ?? storeId,
      storeName: item.storeName,
      expectedQty: item.qty,
      countedQty: Number(counts[item.docId] ?? 0),
      costPrice:
        item.costPrice ??
        impliedCostPrice(item.unitPrice, normaliseMarkup(item.markupPercent)),
      markupPercent: normaliseMarkup(item.markupPercent),
      retailPrice: item.unitPrice,
    }));
    return computeReconciliation(input);
  }, [lines, counts, storeId]);

  const copiedExpected = () => {
    const next: Record<string, string> = {};
    for (const item of lines) next[item.docId] = String(item.qty);
    setCounts(next);
    setError(null);
  };

  const submit = async () => {
    const missing = lines.filter((item) => counts[item.docId] === undefined || counts[item.docId] === "");
    if (missing.length > 0) {
      setError(`Count every line before completing the audit (${missing.length} still blank).`);
      return;
    }
    const invalid = lines.find((item) => {
      const value = Number(counts[item.docId]);
      return !Number.isFinite(value) || value < 0 || !Number.isInteger(value);
    });
    if (invalid) {
      setError(`Enter a whole, non-negative count for ${invalid.name}.`);
      return;
    }
    const pharmacy = pharmacies.find((entry) => entry.id === pharmacyId);
    const store = stores.find((entry) => entry.id === storeId);
    if (!pharmacy || !store) {
      setError("Choose a pharmacy and store first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const summary = await savePharmacyReconciliation({
        pharmacyId,
        pharmacyName: pharmacy.name,
        storeId,
        storeName: store.name,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: lines.map((item) => ({
          itemId: item.docId,
          productId: item.productId,
          name: item.name,
          category: item.category,
          batch: item.batch,
          expiry: item.expiry,
          storeId: item.storeId ?? storeId,
          storeName: item.storeName,
          expectedQty: item.qty,
          countedQty: Number(counts[item.docId]),
          costPrice:
            item.costPrice ??
            impliedCostPrice(item.unitPrice, normaliseMarkup(item.markupPercent)),
          markupPercent: normaliseMarkup(item.markupPercent),
          retailPrice: item.unitPrice,
        })),
      });
      void trackEvent("pulse_stock_reconciliation_completed", {
        pharmacy: pharmacyId,
        lines: summary.lineCount,
        variance: summary.totals.varianceUnits,
      });
      onSaved(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The audit could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto rounded-2xl p-6 sm:max-w-[980px]">
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="flex items-center gap-2 text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            <ClipboardCheck className="h-5 w-5 text-purple-600" aria-hidden="true" />
            New physical count
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-relaxed text-slate-500 dark:text-slate-400">
            Count the shelf, not the system. Every line is valued at supplier cost, the Duniya price
            (cost + markup) and the pharmacy&apos;s retail price.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={pharmacyId}
            onChange={(event) => {
              setPharmacyId(event.target.value);
              setCounts({});
              setError(null);
            }}
            aria-label="Pharmacy"
            className={cn(inputCls, "max-w-[260px]")}
          >
            {pharmacies.map((pharmacy) => (
              <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</option>
            ))}
          </select>
          <select
            value={storeId}
            onChange={(event) => {
              setStoreId(event.target.value);
              setCounts({});
              setError(null);
            }}
            aria-label="Store"
            className={cn(inputCls, "max-w-[240px]")}
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
          <label className="relative block min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search product or batch…"
              className={cn(inputCls, "pl-9")}
            />
          </label>
          <button
            type="button"
            onClick={copiedExpected}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Copy expected
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-[13px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            {stores.length === 0
              ? "This pharmacy has not synced any shelves yet. Choose another pharmacy or ask them to sign in once."
              : "This store has no synced products to count."}
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
              <table className="w-full min-w-[800px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-[10.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/10 dark:bg-white/[0.03]">
                    <th className="px-3 py-2.5 font-semibold">Product</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Expected</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Physical count</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Duniya</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Retail</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {filtered.map((item) => {
                    const count = counts[item.docId];
                    const countValue = Number(count);
                    const variance = Number.isFinite(countValue) && count !== "" ? countValue - item.qty : null;
                    const markup = normaliseMarkup(item.markupPercent);
                    const cost = item.costPrice ?? impliedCostPrice(item.unitPrice, markup);
                    const duniya = cost * (1 + markup / 100);
                    return (
                      <tr key={item.docId} className="hover:bg-slate-50/60 dark:hover:bg-white/5">
                        <td className="max-w-[250px] px-3 py-2.5">
                          <p className="truncate font-semibold text-slate-900 dark:text-white">{item.name}</p>
                          <p className="truncate text-[11.5px] text-slate-400">
                            {item.batch || "No batch"} · {item.category || "General"}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums">{item.qty}</td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            value={count ?? ""}
                            onChange={(event) => {
                              setCounts((prev) => ({ ...prev, [item.docId]: event.target.value }));
                              if (error) setError(null);
                            }}
                            aria-label={`Physical count for ${item.name}`}
                            className="h-8 w-[88px] rounded-md border border-slate-200 bg-white px-2 text-right text-[13px] font-semibold tabular-nums text-slate-900 outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatZmw(cost)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-purple-700 dark:text-purple-300">{formatZmw(duniya)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatZmw(item.unitPrice)}</td>
                        <td className={cn("px-3 py-2.5 text-right font-bold tabular-nums", variance === null ? "text-slate-300" : countTone(variance))}>
                          {variance === null ? "—" : `${variance > 0 ? "+" : ""}${variance}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Counted variance</p>
                <p className={cn("mt-1 text-[18px] font-bold tabular-nums", hasCounts ? countTone(preview.totals.varianceUnits) : "text-slate-300 dark:text-slate-600")}>
                  {hasCounts
                    ? `${preview.totals.varianceUnits > 0 ? "+" : ""}${preview.totals.varianceUnits}`
                    : "—"}
                </p>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  {hasCounts ? `${preview.totals.shortageUnits} short · ${preview.totals.overageUnits} over` : "Enter a physical count"}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Counted units</p>
                <p className="mt-1 text-[18px] font-bold tabular-nums">{hasCounts ? preview.totals.countedUnits : "—"}</p>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">of {preview.totals.expectedUnits} expected</p>
              </div>
              <div className="rounded-xl bg-purple-50 p-3 dark:bg-purple-500/10">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-purple-500 dark:text-purple-300">Duniya value</p>
                <p className="mt-1 text-[18px] font-bold tabular-nums text-purple-700 dark:text-purple-200">{formatZmw(preview.totals.expectedDuniyaValue)}</p>
                <p className="text-[11.5px] text-purple-600/70 dark:text-purple-200/70">
                  Variance {hasCounts ? formatZmw(preview.totals.varianceDuniyaValue) : "—"}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300">Retail value</p>
                <p className="mt-1 text-[18px] font-bold tabular-nums text-emerald-700 dark:text-emerald-200">{formatZmw(preview.totals.expectedRetailValue)}</p>
                <p className="text-[11.5px] text-emerald-600/70 dark:text-emerald-200/70">
                  Variance {hasCounts ? formatZmw(preview.totals.varianceRetailValue) : "—"}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-1.5">
              <label htmlFor="audit-notes" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Audit note <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                id="audit-notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Damaged stock, expiry write-off, drawer context…"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-[13.5px] outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}

        <DialogFooter className="mt-2 gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || lines.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {busy ? "Saving audit…" : "Complete audit"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Audit detail                                                        */
/* ------------------------------------------------------------------ */

function AuditDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [record, setRecord] = useState<ReconciliationRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await getPharmacyReconciliation(id);
        if (active) setRecord(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "The audit could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-2xl p-6 sm:max-w-[760px]">
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            {record ? `${record.pharmacyName} · ${record.storeName}` : "Loading audit…"}
          </DialogTitle>
          <DialogDescription className="text-[13.5px] text-slate-500 dark:text-slate-400">
            {record
              ? `${dateOf(record.completedAtMs)} · counted by ${record.auditor}`
              : "Reading the physical count record."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-[160px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
          </div>
        ) : error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>
        ) : record ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Lines</p>
                <p className="mt-1 text-[18px] font-bold tabular-nums">{record.lineCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Variance</p>
                <p className={cn("mt-1 text-[18px] font-bold tabular-nums", countTone(record.totals.varianceUnits))}>
                  {record.totals.varianceUnits > 0 ? "+" : ""}{record.totals.varianceUnits}
                </p>
              </div>
              <div className="rounded-xl bg-purple-50 p-3 dark:bg-purple-500/10">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-purple-500 dark:text-purple-300">Duniya value</p>
                <p className="mt-1 text-[18px] font-bold tabular-nums text-purple-700 dark:text-purple-200">{formatZmw(record.totals.expectedDuniyaValue)}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300">Retail value</p>
                <p className="mt-1 text-[18px] font-bold tabular-nums text-emerald-700 dark:text-emerald-200">{formatZmw(record.totals.expectedRetailValue)}</p>
              </div>
            </div>

            {record.notes && (
              <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-600 dark:bg-white/5 dark:text-slate-300">
                {record.notes}
              </p>
            )}

            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
              <table className="w-full min-w-[680px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-[10.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/10 dark:bg-white/[0.03]">
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 text-right font-semibold">Expected</th>
                    <th className="px-3 py-2 text-right font-semibold">Counted</th>
                    <th className="px-3 py-2 text-right font-semibold">Variance</th>
                    <th className="px-3 py-2 text-right font-semibold">Duniya</th>
                    <th className="px-3 py-2 text-right font-semibold">Retail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {record.lines.map((line, index) => (
                    <tr key={`${line.itemId ?? line.name}-${index}`}>
                      <td className="max-w-[220px] px-3 py-2">
                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{line.name}</p>
                        <p className="truncate text-[11px] text-slate-400">{line.batch || "No batch"}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.expectedQty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.countedQty}</td>
                      <td className={cn("px-3 py-2 text-right font-bold tabular-nums", countTone(line.varianceQty))}>
                        {line.varianceQty > 0 ? "+" : ""}{line.varianceQty}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatZmw(line.duniyaPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatZmw(line.retailPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <DialogFooter className="mt-2">
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function StockReconciliation() {
  const { toast } = useToast();
  const [items, setItems] = useState<NetworkInventoryItem[]>([]);
  const [pharmacies, setPharmacies] = useState<{ id: string; name: string }[]>([]);
  const [history, setHistory] = useState<ReconciliationSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReconciliationFilter>("all");
  const [startOpen, setStartOpen] = useState(false);
  const [startPharmacyId, setStartPharmacyId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [inventory, audits] = await Promise.all([
        listNetworkInventory(1000),
        listPharmacyReconciliations(100),
      ]);
      setItems(inventory.items);
      setPharmacies(inventory.pharmacies);
      setHistory(audits);
      setCachedAt(null);
      saveCachedRead<CachedPage>(CACHE_KEY, {
        history: audits,
        items: inventory.items,
        pharmacies: inventory.pharmacies,
      });
      setState("ready");
    } catch {
      const cached = loadCachedRead<CachedPage>(CACHE_KEY);
      if (cached) {
        setItems(cached.data.items);
        setPharmacies(cached.data.pharmacies);
        setHistory(cached.data.history);
        setCachedAt(cached.cachedAt);
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

  const lastByPharmacy = useMemo(() => {
    const map = new Map<string, ReconciliationSummary>();
    for (const audit of history) {
      if (!map.has(audit.pharmacyId)) map.set(audit.pharmacyId, audit);
    }
    return map;
  }, [history]);

  const dueAll = useMemo(
    () =>
      pharmacies
        .map((pharmacy) => ({
          ...pharmacy,
          last: lastByPharmacy.get(pharmacy.id),
          schedule: scheduleLabel(lastByPharmacy.get(pharmacy.id)),
        }))
        .sort((a, b) => {
          const order = { "Never counted": 0, "Due now": 1 } as Record<string, number>;
          const aRank = order[a.schedule.label] ?? 2;
          const bRank = order[b.schedule.label] ?? 2;
          return aRank - bRank || a.name.localeCompare(b.name);
        }),
    [pharmacies, lastByPharmacy]
  );
  const due = useMemo(() => dueAll.slice(0, 6), [dueAll]);

  const totals = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const thisMonth = history.filter((audit) => audit.completedAtMs >= monthStart.getTime());
    return {
      completed: thisMonth.length,
      due: dueAll.filter((entry) => entry.schedule.label === "Due now" || entry.schedule.label === "Never counted").length,
      variance: thisMonth.reduce((acc, audit) => acc + (audit.totals?.varianceDuniyaValue ?? 0), 0),
      value: items.reduce((acc, item) => {
        const cost = item.costPrice ?? impliedCostPrice(item.unitPrice, normaliseMarkup(item.markupPercent));
        return acc + item.qty * cost * (1 + normaliseMarkup(item.markupPercent) / 100);
      }, 0),
    };
  }, [history, dueAll, items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((audit) => {
      const variance = audit.totals?.varianceUnits ?? 0;
      if (filter === "balanced" && variance !== 0) return false;
      if (filter === "variance" && variance === 0) return false;
      return (
        !q ||
        audit.pharmacyName.toLowerCase().includes(q) ||
        audit.storeName.toLowerCase().includes(q) ||
        audit.auditor.toLowerCase().includes(q)
      );
    });
  }, [history, query, filter]);

  return (
    <div className="space-y-7" data-tour="pulse-reconciliation">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-bold tracking-tight text-slate-900 dark:text-white">
            Stock Reconciliation
          </h2>
          <p className="mt-1 max-w-3xl text-[14px] text-slate-500 dark:text-slate-400">
            Two-week physical counts across the network. Expected stock, counted stock and every
            variance are valued at cost, Duniya price and retail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
          >
            <RefreshCw className={cn("h-4 w-4", state === "loading" && "animate-spin")} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setStartPharmacyId(null);
              setStartOpen(true);
            }}
            disabled={pharmacies.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            New count
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "Audits this month", value: String(totals.completed), hint: "Completed physical counts", icon: ClipboardCheck, tone: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300" },
          { label: "Due now", value: String(totals.due), hint: "On the two-week cadence", icon: CalendarClock, tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
          { label: "Duniya variance", value: formatZmw(totals.variance), hint: "This month, signed", icon: Scale, tone: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" },
          { label: "Network Duniya stock", value: formatZmw(totals.value), hint: "At cost + standard markup", icon: TrendingUp, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className={cn(cardCls, "p-4")}>
              <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", stat.tone)}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="mt-3 text-2xl font-bold leading-none tracking-tight tabular-nums">{stat.value}</p>
              <p className="mt-1.5 text-[13px] font-semibold">{stat.label}</p>
              <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">{stat.hint}</p>
            </div>
          );
        })}
      </div>

      {cachedAt && (
        <p className="text-[12px] text-amber-600 dark:text-amber-400">
          Showing the last synced audit picture from {formatCachedAt(cachedAt)}. Refresh when you are back online.
        </p>
      )}

      <section className={cn(cardCls, "p-5")} aria-labelledby="audit-schedule">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 id="audit-schedule" className="text-[15px] font-bold text-slate-900 dark:text-white">
              Next counts
            </h3>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
              Audits are due every {RECONCILIATION_CADENCE_DAYS} days from the last completed count.
            </p>
          </div>
        </div>
        {due.length === 0 ? (
          <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
            No active pharmacies are reporting shelves yet.
          </p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {due.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setStartPharmacyId(entry.id);
                  setStartOpen(true);
                }}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3 text-left transition-colors hover:border-purple-200 hover:bg-purple-50/60 dark:border-white/10 dark:bg-white/5 dark:hover:border-purple-500/30 dark:hover:bg-purple-500/10"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{entry.name}</span>
                  <span className="block truncate text-[11.5px] text-slate-400">
                    {entry.last ? `Last ${dateOf(entry.last.completedAtMs)}` : "No audit yet"}
                  </span>
                </span>
                <span className={cn("shrink-0 text-[11.5px] font-bold", entry.schedule.tone)}>{entry.schedule.label}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block w-full max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pharmacy, store or auditor…"
            className={cn(inputCls, "pl-9")}
          />
        </label>
        <div className="flex gap-1.5" role="group" aria-label="Filter audits">
          {(["all", "variance", "balanced"] as ReconciliationFilter[]).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setFilter(entry)}
              aria-pressed={filter === entry}
              className={cn(
                "inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold capitalize transition-colors",
                filter === entry
                  ? "bg-purple-600 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
              )}
            >
              {entry === "all" ? "All audits" : entry === "variance" ? "With variance" : "Balanced"}
            </button>
          ))}
        </div>
      </div>

      {state === "failed" ? (
        <div className={cn(cardCls, "p-8 text-center")}>
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">Reconciliation is unavailable</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-slate-500 dark:text-slate-400">
            Check your connection, then refresh. Completed audits remain in Firestore.
          </p>
        </div>
      ) : state === "loading" ? (
        <div className={cn(cardCls, "flex min-h-[180px] items-center justify-center gap-2 p-8")} aria-busy="true">
          <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
          <p className="text-[13.5px] text-slate-500 dark:text-slate-400">Reading the audit history…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(cardCls, "flex min-h-[180px] flex-col items-center justify-center gap-2.5 p-8 text-center")}>
          <ClipboardCheck className="h-7 w-7 text-slate-300 dark:text-slate-600" />
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">
            {history.length === 0 ? "No physical counts yet" : "Nothing matches this view"}
          </p>
          <p className="max-w-md text-[13px] text-slate-500 dark:text-slate-400">
            {history.length === 0
              ? "Start the first two-week count. The network's expected shelves become the checklist."
              : "Clear the search or choose another filter."}
          </p>
        </div>
      ) : (
        <div className={cn(cardCls, "overflow-hidden")}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                  <th className="px-5 py-3 font-semibold">Pharmacy</th>
                  <th className="px-3 py-3 font-semibold">Counted</th>
                  <th className="px-3 py-3 text-right font-semibold">Variance</th>
                  <th className="px-3 py-3 text-right font-semibold">Duniya value</th>
                  <th className="px-3 py-3 text-right font-semibold">Retail value</th>
                  <th className="px-3 py-3 font-semibold">Auditor</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((audit) => {
                  const variance = audit.totals?.varianceUnits ?? 0;
                  return (
                    <tr key={audit.id} className="hover:bg-slate-50/80 dark:hover:bg-white/5">
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-slate-900 dark:text-white">{audit.pharmacyName}</p>
                        <p className="text-[11.5px] text-slate-400">{audit.storeName} · {audit.lineCount} lines</p>
                      </td>
                      <td className="px-3 py-3.5 text-slate-600 dark:text-slate-300">{dateOf(audit.completedAtMs)}</td>
                      <td className={cn("px-3 py-3.5 text-right font-bold tabular-nums", countTone(variance))}>
                        {variance > 0 ? "+" : ""}{variance}
                        <span className="ml-1 text-[10.5px] font-medium text-slate-400">
                          {variance < 0 ? "short" : variance > 0 ? "over" : "balanced"}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-purple-700 dark:text-purple-300">{formatZmw(audit.totals?.expectedDuniyaValue ?? 0)}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{formatZmw(audit.totals?.expectedRetailValue ?? 0)}</td>
                      <td className="px-3 py-3.5 text-slate-600 dark:text-slate-300">{audit.auditor}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => setDetailId(audit.id)}
                          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
                        >
                          View <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-5 py-3 text-[12px] text-slate-400 dark:border-white/5 dark:text-slate-500">
            Showing {filtered.length} of {history.length} audits · every count is a permanent record
          </div>
        </div>
      )}

      {startOpen && (
        <StartAuditDialog
          items={items}
          pharmacies={pharmacies}
          initialPharmacyId={startPharmacyId}
          onClose={() => {
            setStartOpen(false);
            setStartPharmacyId(null);
          }}
          onSaved={(summary) => {
            setStartOpen(false);
            setStartPharmacyId(null);
            setHistory((prev) => [summary, ...prev]);
            toast({
              title: "Physical count saved",
              description: `${summary.pharmacyName} · ${summary.storeName} · ${summary.totals.varianceUnits > 0 ? "+" : ""}${summary.totals.varianceUnits} units variance.`,
            });
          }}
        />
      )}
      {detailId && <AuditDetailDialog id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
