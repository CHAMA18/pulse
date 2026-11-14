"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Inbox,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  SearchX,
  Send,
  Truck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusPill } from "@/components/pharmacy/pharmacy-shared";
import { useToast } from "@/hooks/use-toast";
import {
  listReceivedStockRequests,
  updateReceivedStockRequest,
  type NetworkStockRequest,
} from "@/lib/cloud/stock-requests";
import {
  loadWarehouseItems,
  recordWarehouseMovement,
  type WarehouseItem,
} from "@/lib/warehouse";
import { DUNIYA_MARKUP_PERCENT, duniyaUnitPrice, formatZmw } from "@/lib/pricing";
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
/* Pulse receiving desk — Stock Requests Received                      */
/* ------------------------------------------------------------------ */

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";
const inputCls =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[13.5px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white";

const CACHE_KEY = "dashboard-stock-requests-received";

type Filter = "all" | "pending" | "approved" | "dispatched" | "delivered" | "closed";
type CachedPage = { requests: NetworkStockRequest[] };

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "dispatched", label: "Dispatched" },
  { id: "delivered", label: "Received" },
  { id: "closed", label: "Closed" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending review",
  approved: "Approved",
  dispatched: "Dispatched",
  delivered: "Received",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function statusPill(status: string): string {
  if (status === "pending") return "pending";
  if (status === "approved") return "approved";
  if (status === "dispatched") return "in-transit";
  if (status === "delivered") return "received";
  if (status === "rejected") return "rejected";
  return "cancelled";
}

function timeOf(value?: number): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statTile(label: string, value: string, hint: string, tone: string) {
  return { label, value, hint, tone };
}

/* ------------------------------------------------------------------ */
/* Dispatch dialog                                                     */
/* ------------------------------------------------------------------ */

function DispatchDialog({
  request,
  onClose,
  onDispatched,
}: {
  request: NetworkStockRequest;
  onClose: () => void;
  onDispatched: (request: NetworkStockRequest) => void;
}) {
  const { toast } = useToast();
  const [warehouse, setWarehouse] = useState<WarehouseItem[]>([]);
  const [itemId, setItemId] = useState("");
  const [cost, setCost] = useState("");
  const [markup, setMarkup] = useState(String(DUNIYA_MARKUP_PERCENT));
  const [batch, setBatch] = useState(request.batch ?? "");
  const [expiry, setExpiry] = useState(request.expiry ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const items = loadWarehouseItems();
    setWarehouse(items);
    const match = items.find(
      (item) => item.name.trim().toLowerCase() === request.item.trim().toLowerCase()
    );
    if (match) {
      setItemId(match.id);
      setCost(String(match.unitPrice || ""));
      setBatch(match.batch);
      setExpiry(match.expiry);
      setMarkup(String(match.markupPercent ?? DUNIYA_MARKUP_PERCENT));
    }
  }, [request.item]);

  const selected = warehouse.find((item) => item.id === itemId);
  const costValue = Math.max(0, Number(cost) || 0);
  const markupValue = Math.max(0, Math.min(100, Number(markup) || 0));
  const duniya = duniyaUnitPrice(costValue, markupValue);
  const total = duniya * request.qty;
  const notEnough = Boolean(selected && selected.qty < request.qty);

  const submit = async () => {
    if (!Number.isFinite(costValue) || costValue <= 0) {
      setError("Enter the supplier cost for this batch.");
      return;
    }
    if (!batch.trim()) {
      setError("Choose or enter the batch being dispatched.");
      return;
    }
    if (!expiry) {
      setError("Enter the batch expiry date.");
      return;
    }
    if (notEnough) {
      setError(`Only ${selected?.qty ?? 0} units of this batch are on the warehouse shelf.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const updated = await updateReceivedStockRequest({
        docId: request.docId,
        action: "dispatch",
        unitCost: costValue,
        markupPercent: markupValue,
        batch: batch.trim(),
        expiry,
        ...(note.trim() ? { note: note.trim() } : {}),
      });

      // The warehouse ledger is device-local. Move the shelf only after the
      // network accepted the dispatch, and only when the batch is linked.
      if (selected) {
        const movement = recordWarehouseMovement({
          type: "transfer",
          itemId: selected.id,
          qty: request.qty,
          reason: "Stock request fulfilment",
          note: [`${request.requestId} · ${request.pharmacyName}`, note.trim()]
            .filter(Boolean)
            .join(" · "),
          destinationPharmacyId: request.pharmacyId,
          destinationPharmacyName: request.pharmacyName,
          unitCost: costValue,
          markupPercent: markupValue,
          requestDocId: request.docId,
          actor: { name: "Pulse receiving desk", email: "" },
        });
        if (!movement) {
          toast({
            title: "Dispatched — warehouse ledger needs attention",
            description:
              "The pharmacy was notified, but the local warehouse batch could not be reduced. Record the transfer manually.",
            variant: "destructive",
          });
        }
      }

      toast({
        title: `${request.requestId} dispatched`,
        description: `${request.qty} units of ${request.item} · ${formatZmw(duniya)} Duniya price · ${formatZmw(total)} total.`,
      });
      void trackEvent("pulse_stock_request_dispatched", {
        request: request.requestId,
        qty: request.qty,
        duniya,
      });
      onDispatched(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request could not be dispatched.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-2xl p-6 sm:max-w-[620px]">
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="flex items-center gap-2 text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            <Truck className="h-5 w-5 text-purple-600" aria-hidden="true" />
            Dispatch {request.item}
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-relaxed text-slate-500 dark:text-slate-400">
            {request.qty} units for {request.pharmacyName} · {request.storeName}. Confirm the batch
            and three price layers before the stock leaves the hub.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="dispatch-batch-item" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Warehouse batch
            </label>
            <select
              id="dispatch-batch-item"
              value={itemId}
              onChange={(event) => {
                const nextId = event.target.value;
                setItemId(nextId);
                const match = warehouse.find((item) => item.id === nextId);
                if (match) {
                  setCost(String(match.unitPrice || ""));
                  setBatch(match.batch);
                  setExpiry(match.expiry);
                  setMarkup(String(match.markupPercent ?? DUNIYA_MARKUP_PERCENT));
                }
                setError(null);
              }}
              className={inputCls}
            >
              <option value="">Manual batch (not linked to a warehouse shelf)</option>
              {warehouse
                .filter((item) => item.name.trim().toLowerCase() === request.item.trim().toLowerCase())
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.batch} · {item.qty} on hand · cost {formatZmw(item.unitPrice)}
                  </option>
                ))}
            </select>
            {selected ? (
              <p className="text-[12px] text-slate-500 dark:text-slate-400">
                Dispatching will also move {request.qty} units out of{" "}
                <span className="font-semibold text-slate-700 dark:text-slate-200">{selected.batch}</span>{" "}
                in Stock Movement.
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                No warehouse batch linked. The request will dispatch, but the local warehouse ledger
                will not move.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="dispatch-batch" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Batch
              </label>
              <input
                id="dispatch-batch"
                value={batch}
                onChange={(event) => setBatch(event.target.value)}
                className={inputCls}
                placeholder="e.g. WH-2026-04"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="dispatch-expiry" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Expiry
              </label>
              <input
                id="dispatch-expiry"
                type="date"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                className={inputCls}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="dispatch-cost" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Supplier cost / unit (ZMW)
              </label>
              <input
                id="dispatch-cost"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={cost}
                onChange={(event) => {
                  setCost(event.target.value);
                  setError(null);
                }}
                className={inputCls}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="dispatch-markup" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Duniya markup (%)
              </label>
              <input
                id="dispatch-markup"
                type="number"
                min={0}
                max={100}
                step="0.5"
                inputMode="decimal"
                value={markup}
                onChange={(event) => setMarkup(event.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-white/10 dark:bg-white/5">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Cost price</p>
              <p className="mt-1 text-[16px] font-bold tabular-nums">{formatZmw(costValue)}</p>
            </div>
            <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-3.5 dark:border-purple-500/30 dark:bg-purple-500/10">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-purple-500 dark:text-purple-300">
                Duniya price · +{markupValue}%
              </p>
              <p className="mt-1 text-[16px] font-bold tabular-nums text-purple-700 dark:text-purple-200">
                {formatZmw(duniya)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300">
                Total · {request.qty} units
              </p>
              <p className="mt-1 text-[16px] font-bold tabular-nums text-emerald-700 dark:text-emerald-200">
                {formatZmw(total)}
              </p>
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="dispatch-note" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Dispatch note <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="dispatch-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Rider, vehicle, delivery window…"
              className={inputCls}
            />
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
            </p>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || notEnough}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {busy ? "Dispatching…" : "Dispatch stock"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Reject dialog                                                       */
/* ------------------------------------------------------------------ */

function RejectDialog({
  request,
  onClose,
  onRejected,
}: {
  request: NetworkStockRequest;
  onClose: () => void;
  onRejected: (request: NetworkStockRequest) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateReceivedStockRequest({
        docId: request.docId,
        action: "reject",
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onRejected(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request could not be rejected.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="rounded-2xl p-6 sm:max-w-[460px]">
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="text-[18px] font-bold tracking-tight text-slate-900 dark:text-white">
            Reject {request.requestId}?
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-relaxed text-slate-500 dark:text-slate-400">
            {request.pharmacyName} will see the reason in their queue. The stock stays at the hub.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 grid gap-1.5">
          <label htmlFor="reject-reason" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
            Reason <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="reject-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Out of stock, duplicate request, account on hold…"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-[13.5px] outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
        {error && <p role="alert" className="mt-3 text-[12.5px] text-rose-600">{error}</p>}
        <DialogFooter className="mt-2 gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">
            Keep request
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-md bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            {busy ? "Rejecting…" : "Reject request"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Detail dialog                                                       */
/* ------------------------------------------------------------------ */

function DetailDialog({ request, onClose }: { request: NetworkStockRequest; onClose: () => void }) {
  const rows: { label: string; value: string }[] = [
    { label: "Pharmacy", value: request.pharmacyName },
    { label: "Store", value: request.storeName },
    { label: "Submitted by", value: `${request.submittedByName} · ${request.submittedByEmail}` },
    { label: "Submitted", value: timeOf(request.submittedAt) },
    { label: "Request", value: `${request.requestId} · ${request.qty} units` },
    ...(request.notes ? [{ label: "Pharmacy note", value: request.notes }] : []),
    ...(request.unitCost ? [{ label: "Supplier cost", value: formatZmw(request.unitCost) }] : []),
    ...(request.markupPercent !== undefined
      ? [{ label: "Duniya markup", value: `${request.markupPercent}%` }]
      : []),
    ...(request.duniyaUnitPrice
      ? [{ label: "Duniya price", value: formatZmw(request.duniyaUnitPrice) }]
      : []),
    ...(request.totalDuniya ? [{ label: "Duniya total", value: formatZmw(request.totalDuniya) }] : []),
    ...(request.batch ? [{ label: "Batch", value: `${request.batch}${request.expiry ? ` · ${request.expiry}` : ""}` }] : []),
    ...(request.retailUnitPrice
      ? [{ label: "Pharmacy retail", value: formatZmw(request.retailUnitPrice) }]
      : []),
    ...(request.totalRetail ? [{ label: "Retail total", value: formatZmw(request.totalRetail) }] : []),
    ...(request.approvedBy ? [{ label: "Approved by", value: `${request.approvedBy} · ${timeOf(request.approvedAt)}` }] : []),
    ...(request.dispatchedBy ? [{ label: "Dispatched by", value: `${request.dispatchedBy} · ${timeOf(request.dispatchedAt)}` }] : []),
    ...(request.receivedBy ? [{ label: "Received by", value: `${request.receivedBy} · ${timeOf(request.deliveredAt)}` }] : []),
    ...(request.dispatchNote ? [{ label: "Dispatch note", value: request.dispatchNote }] : []),
    ...(request.decisionNote ? [{ label: "Decision note", value: request.decisionNote }] : []),
  ];

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl p-6 sm:max-w-[520px]">
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            {request.item}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-[13.5px] text-slate-500 dark:text-slate-400">
            <StatusPill status={statusPill(request.status)} label={STATUS_LABEL[request.status] ?? request.status} />
            <span>{request.requestId}</span>
          </DialogDescription>
        </DialogHeader>
        <dl className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-4 py-3">
              <dt className="w-36 shrink-0 text-[12px] font-semibold text-slate-400">{row.label}</dt>
              <dd className="min-w-0 flex-1 text-right text-[13px] font-medium text-slate-800 dark:text-slate-100">{row.value}</dd>
            </div>
          ))}
        </dl>
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

export function StockRequestsReceived() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<NetworkStockRequest[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dispatchTarget, setDispatchTarget] = useState<NetworkStockRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<NetworkStockRequest | null>(null);
  const [detailTarget, setDetailTarget] = useState<NetworkStockRequest | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const rows = await listReceivedStockRequests(500);
      setRequests(rows);
      setCachedAt(null);
      saveCachedRead<CachedPage>(CACHE_KEY, { requests: rows });
      setState("ready");
    } catch {
      const cached = loadCachedRead<CachedPage>(CACHE_KEY);
      if (cached) {
        setRequests(cached.data.requests);
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

  const replace = (updated: NetworkStockRequest) => {
    setRequests((prev) => prev.map((row) => (row.docId === updated.docId ? updated : row)));
    setCachedAt(null);
  };

  const approve = async (request: NetworkStockRequest) => {
    setBusyId(request.docId);
    try {
      const updated = await updateReceivedStockRequest({ docId: request.docId, action: "approve" });
      replace(updated);
      toast({ title: `${request.requestId} approved`, description: "It is ready to dispatch." });
      void trackEvent("pulse_stock_request_approved", { request: request.requestId });
    } catch (err) {
      toast({
        title: "Could not approve",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const map = { pending: 0, approved: 0, dispatched: 0, delivered: 0, rejected: 0, cancelled: 0 };
    for (const request of requests) {
      map[request.status] = (map[request.status] ?? 0) + 1;
    }
    return map;
  }, [requests]);

  const unitsPending = useMemo(
    () =>
      requests
        .filter((request) => request.status === "pending" || request.status === "approved")
        .reduce((acc, request) => acc + request.qty, 0),
    [requests]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests
      .filter((request) => {
        if (filter === "all") return true;
        if (filter === "closed") return request.status === "rejected" || request.status === "cancelled";
        return request.status === filter;
      })
      .filter(
        (request) =>
          !q ||
          request.item.toLowerCase().includes(q) ||
          request.pharmacyName.toLowerCase().includes(q) ||
          request.storeName.toLowerCase().includes(q) ||
          request.requestId.toLowerCase().includes(q)
      );
  }, [requests, filter, query]);

  const stats = [
    statTile("Pending review", String(counts.pending), "Waiting for approval", "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"),
    statTile("Approved", String(counts.approved), "Ready to dispatch", "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"),
    statTile("Dispatched", String(counts.dispatched), "With the pharmacy", "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"),
    statTile("Received", String(counts.delivered), "Closed by pharmacy", "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"),
    statTile("Units waiting", unitsPending.toLocaleString(), "Across open lines", "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200"),
  ];

  return (
    <div className="space-y-7" data-tour="pulse-stock-requests">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-bold tracking-tight text-slate-900 dark:text-white">
            Stock Requests Received
          </h2>
          <p className="mt-1 max-w-3xl text-[14px] text-slate-500 dark:text-slate-400">
            Every replenishment request from the network. Approve it, dispatch a priced batch, and the
            pharmacy confirms receipt and sets its retail price.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <RefreshCw className={cn("h-4 w-4", state === "loading" && "animate-spin")} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className={cn(cardCls, "p-4")}>
            <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", stat.tone)}>
              {stat.label === "Pending review" ? (
                <Clock3 className="h-4 w-4" aria-hidden="true" />
              ) : stat.label === "Approved" ? (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              ) : stat.label === "Dispatched" ? (
                <Truck className="h-4 w-4" aria-hidden="true" />
              ) : stat.label === "Received" ? (
                <PackageCheck className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Inbox className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <p className="mt-3 text-2xl font-bold leading-none tracking-tight tabular-nums">{stat.value}</p>
            <p className="mt-1.5 text-[13px] font-semibold">{stat.label}</p>
            <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">{stat.hint}</p>
          </div>
        ))}
      </div>

      {cachedAt && (
        <p className="text-[12px] text-amber-600 dark:text-amber-400">
          Showing the last synced queue from {formatCachedAt(cachedAt)}. Refresh when you are back online.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block w-full max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pharmacy, product, store or reference…"
            aria-label="Search stock requests"
            className={cn(inputCls, "pl-9")}
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter stock requests">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
              className={cn(
                "inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-colors",
                filter === item.id
                  ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {state === "failed" ? (
        <div className={cn(cardCls, "p-8 text-center")}>
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">The receiving queue is unavailable</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-slate-500 dark:text-slate-400">
            Check your Pulse console connection, then refresh. Requests raised by pharmacies are safe in
            Firestore and will appear here.
          </p>
          <button type="button" onClick={() => void load()} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-purple-600 px-4 text-[13px] font-semibold text-white">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      ) : state === "loading" ? (
        <div className={cn(cardCls, "flex min-h-[180px] flex-col items-center justify-center gap-2 p-8 text-center")} aria-busy="true">
          <Loader2 className="h-5 w-5 animate-spin text-purple-600" aria-hidden="true" />
          <p className="text-[13.5px] text-slate-500 dark:text-slate-400">Reading the receiving desk…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(cardCls, "flex min-h-[180px] flex-col items-center justify-center gap-2.5 p-8 text-center")}>
          <SearchX className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">
            {requests.length === 0 ? "No stock requests yet" : "Nothing matches this view"}
          </p>
          <p className="max-w-md text-[13px] text-slate-500 dark:text-slate-400">
            {requests.length === 0
              ? "When a pharmacy raises a request, it lands here and the Owners and Admins are emailed immediately."
              : "Clear the search or choose another status."}
          </p>
        </div>
      ) : (
        <div className={cn(cardCls, "overflow-hidden")}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                  <th className="px-5 py-3 font-semibold">Request</th>
                  <th className="px-3 py-3 font-semibold">Item</th>
                  <th className="px-3 py-3 text-right font-semibold">Qty</th>
                  <th className="px-3 py-3 font-semibold">Priority</th>
                  <th className="px-3 py-3 font-semibold">Submitted</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 text-right font-semibold">Duniya value</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((request) => (
                  <tr key={request.docId} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-white/5">
                    <td className="max-w-[230px] px-5 py-3.5">
                      <p className="truncate font-semibold text-slate-900 dark:text-white">{request.pharmacyName}</p>
                      <p className="font-mono text-[11.5px] text-slate-500 dark:text-slate-400">{request.requestId}</p>
                      <p className="truncate text-[11.5px] text-slate-400">{request.storeName}</p>
                    </td>
                    <td className="max-w-[240px] px-3 py-3.5">
                      <p className="truncate font-medium text-slate-800 dark:text-slate-100">{request.item}</p>
                      {request.batch && (
                        <p className="truncate text-[11.5px] text-slate-400">Batch {request.batch}{request.expiry ? ` · ${request.expiry}` : ""}</p>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-right font-bold tabular-nums">{request.qty}</td>
                    <td className="px-3 py-3.5"><StatusPill status={request.priority} /></td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-slate-600 dark:text-slate-300">{timeOf(request.submittedAt)}</td>
                    <td className="px-3 py-3.5">
                      <StatusPill status={statusPill(request.status)} label={STATUS_LABEL[request.status] ?? request.status} />
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      {request.totalDuniya ? (
                        <>
                          <p className="font-semibold tabular-nums">{formatZmw(request.totalDuniya)}</p>
                          <p className="text-[11.5px] text-slate-400">{formatZmw(request.duniyaUnitPrice ?? 0)} / unit</p>
                        </>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {request.status === "pending" && (
                          <>
                            <button
                              type="button"
                              onClick={() => void approve(request)}
                              disabled={busyId === request.docId}
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-200 px-2.5 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                            >
                              {busyId === request.docId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                              Approve
                            </button>
                            <button type="button" onClick={() => setRejectTarget(request)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 px-2.5 text-[12px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10">
                              <XCircle className="h-3.5 w-3.5" /> Reject
                            </button>
                          </>
                        )}
                        {request.status === "approved" && (
                          <>
                            <button type="button" onClick={() => setDispatchTarget(request)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-purple-600 px-3 text-[12px] font-semibold text-white hover:bg-purple-700">
                              <Send className="h-3.5 w-3.5" /> Dispatch
                            </button>
                            <button type="button" onClick={() => setRejectTarget(request)} className="inline-flex h-8 items-center rounded-md border border-rose-200 px-2.5 text-[12px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10">
                              Reject
                            </button>
                          </>
                        )}
                        {request.status === "dispatched" && (
                          <span className="inline-flex h-8 items-center gap-1.5 text-[12px] font-medium text-purple-600 dark:text-purple-300">
                            <Truck className="h-3.5 w-3.5" /> Awaiting receipt
                          </span>
                        )}
                        <button type="button" onClick={() => setDetailTarget(request)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10">
                          View <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-5 py-3 text-[12px] text-slate-400 dark:border-white/5 dark:text-slate-500">
            Showing {filtered.length} of {requests.length} requests · newest first
          </div>
        </div>
      )}

      {dispatchTarget && (
        <DispatchDialog
          request={dispatchTarget}
          onClose={() => setDispatchTarget(null)}
          onDispatched={(updated) => {
            replace(updated);
            setDispatchTarget(null);
          }}
        />
      )}
      {rejectTarget && (
        <RejectDialog
          request={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={(updated) => {
            replace(updated);
            setRejectTarget(null);
            toast({ title: `${updated.requestId} rejected`, description: "The pharmacy can see the reason." });
          }}
        />
      )}
      {detailTarget && <DetailDialog request={detailTarget} onClose={() => setDetailTarget(null)} />}
    </div>
  );
}
