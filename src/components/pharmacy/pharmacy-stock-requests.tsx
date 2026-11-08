"use client";

import { motion } from "framer-motion";
import {
  AlertCircle,
  ClipboardList,
  PackagePlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatDay,
  loadStockRequests,
  nextId,
  resolveStoreId,
  saveStockRequests,
  type RequestPriority,
  type RequestStatus,
  type StockRequest,
} from "@/components/pharmacy/pharmacy-data";
import {
  PageHeader,
  pharmacyCardCls,
  StatusPill,
} from "@/components/pharmacy/pharmacy-shared";
import { recordAudit } from "@/lib/audit-log";
import { useToast } from "@/hooks/use-toast";
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
/* Model                                                               */
/* ------------------------------------------------------------------ */

type Errors = {
  item?: string;
  qty?: string;
};

const STATUS_ORDER: RequestStatus[] = ["pending", "approved", "dispatched", "delivered", "cancelled"];

/* ------------------------------------------------------------------ */
/* New request dialog                                                  */
/* ------------------------------------------------------------------ */

function NewRequestDialog({
  open,
  onOpenChange,
  requests,
  onCreated,
  actor,
  storeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: StockRequest[];
  onCreated: (request: StockRequest) => void;
  actor: { name: string; email: string };
  /** Destination store for the request ("all" records into the main store). */
  storeId: string;
}) {
  const { toast } = useToast();

  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("routine");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const itemRef = useRef<HTMLInputElement>(null);

  // Reopening starts a fresh form (render-time reset, like the register dialog).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setItem("");
      setQty("");
      setPriority("routine");
      setNotes("");
      setErrors({});
      setFormError(null);
    }
  }

  const validate = (): Errors => {
    const next: Errors = {};
    const trimmed = item.trim();
    if (trimmed.length < 2) next.item = "Describe the item you need.";
    else if (
      requests.some(
        (r) => r.status === "pending" && r.item.toLowerCase() === trimmed.toLowerCase()
      )
    )
      next.item = "This item already has an open request.";
    const parsed = Number.parseInt(qty, 10);
    if (!qty.trim() || !Number.isFinite(parsed) || parsed < 1)
      next.qty = "Request at least one unit.";
    else if (parsed > 10000) next.qty = "That's beyond the hub's single-request limit.";
    return next;
  };

  const submit = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.item) itemRef.current?.focus();
      return;
    }

    const request: StockRequest = {
      id: nextId(requests, "REQ"),
      item: item.trim(),
      qty: Number.parseInt(qty, 10),
      priority,
      status: "pending",
      submittedAt: Date.now(),
      ...(storeId !== "all" ? { storeId } : {}),
    };
    onCreated(request);
    toast({
      title: "Stock request submitted",
      description: `${request.item} × ${request.qty} is with the Pulse hub for approval.`,
    });
    if (actor.email) {
      recordAudit({
        title: "Stock Requested",
        action: "Update",
        detail: `${request.id} · ${request.item} × ${request.qty}`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_stock_requested", { priority, qty: request.qty });
    onOpenChange(false);
  };

  const inputBase =
    "h-11 w-full rounded-md border bg-white px-3.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 dark:bg-white/5 dark:text-white";

  const inputState = (hasError?: string) =>
    hasError
      ? "border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-500/10"
      : "border-slate-200 hover:border-slate-300 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10";

  const fieldError = (message?: string) =>
    message && (
      <p role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
        <AlertCircle className="h-3.5 w-3.5" /> {message}
      </p>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="rounded-2xl p-6 sm:max-w-[460px]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          itemRef.current?.focus();
        }}
      >
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            Request stock
          </DialogTitle>
          <DialogDescription className="text-[13.5px] text-slate-500 dark:text-slate-400">
            Send a replenishment request to the Pulse hub — approved items arrive with your next
            delivery.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-4">
          {/* Item */}
          <div>
            <label htmlFor="request-item" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Item
            </label>
            <input
              ref={itemRef}
              id="request-item"
              type="text"
              placeholder="e.g. Coartem 20/60 (pack)"
              value={item}
              onChange={(e) => {
                setItem(e.target.value);
                if (errors.item) setErrors((p) => ({ ...p, item: undefined }));
                if (formError) setFormError(null);
              }}
              aria-invalid={!!errors.item}
              className={cn(inputBase, inputState(errors.item))}
            />
            {fieldError(errors.item)}
          </div>

          {/* Quantity */}
          <div>
            <label htmlFor="request-qty" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Quantity
            </label>
            <input
              id="request-qty"
              type="number"
              min={1}
              placeholder="e.g. 40"
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                if (errors.qty) setErrors((p) => ({ ...p, qty: undefined }));
              }}
              aria-invalid={!!errors.qty}
              className={cn(inputBase, inputState(errors.qty))}
            />
            {fieldError(errors.qty)}
          </div>

          {/* Priority */}
          <div>
            <span className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Priority
            </span>
            <div role="radiogroup" aria-label="Priority" className="flex items-center gap-1.5">
              {(["routine", "urgent"] as RequestPriority[]).map((option) => {
                const active = priority === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPriority(option)}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                      active
                        ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                        : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="request-notes" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Notes <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              id="request-notes"
              rows={3}
              placeholder="Anything the hub should know — batch preferences, urgency context…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          >
            <PackagePlus className="h-4 w-4" aria-hidden="true" />
            Submit request
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PharmacyStockRequests({ storeId = "all" }: { storeId?: string }) {
  const { toast } = useToast();

  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [actor, setActor] = useState({ name: "", email: "" });

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
      setRequests(loadStockRequests());
      setHydrated(true);
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // The queue follows the sidebar's store view; new requests are recorded for it.
  const visible = useMemo(
    () =>
      storeId === "all"
        ? requests
        : requests.filter((entry) => resolveStoreId(entry) === storeId),
    [requests, storeId]
  );

  const counts = useMemo(() => {
    const map = new Map<RequestStatus, number>(STATUS_ORDER.map((s) => [s, 0]));
    for (const r of visible) map.set(r.status, (map.get(r.status) ?? 0) + 1);
    return map;
  }, [visible]);

  const sorted = useMemo(
    () => [...visible].sort((a, b) => b.submittedAt - a.submittedAt),
    [visible]
  );

  const persist = (next: StockRequest[]) => {
    setRequests(next);
    saveStockRequests(next);
  };

  const onCreated = (request: StockRequest) => {
    persist([request, ...requests]);
  };

  const onCancel = (request: StockRequest) => {
    persist(requests.map((r) => (r.id === request.id ? { ...r, status: "cancelled" } : r)));
    toast({
      title: "Request cancelled",
      description: `${request.id} · ${request.item} was withdrawn.`,
    });
    if (actor.email) {
      recordAudit({
        title: "Stock Request Cancelled",
        action: "Update",
        detail: `${request.id} · ${request.item}`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_stock_request_cancelled", { request: request.id });
  };

  const EmptyIcon: LucideIcon = ClipboardList;

  return (
    <div aria-labelledby="pharmacy-requests-title">
      <PageHeader
        icon={ClipboardList}
        title="Stock Requests"
        subtitle="Replenishment requests to the Pulse hub"
        tourId="ph-requests"
        actions={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-shadow hover:shadow-[0_12px_26px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          >
            <PackagePlus className="h-4 w-4" aria-hidden="true" />
            New request
          </button>
        }
      />
      <h2 id="pharmacy-requests-title" className="sr-only">
        Stock Requests
      </h2>

      {/* Status chips */}
      <div className={cn(pharmacyCardCls, "mt-5 flex flex-wrap gap-3 p-4")}>
        {STATUS_ORDER.filter((s) => s !== "cancelled" || counts.get("cancelled")).map((status) => (
          <div key={status} className="flex min-w-[120px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
            <p className="text-[18px] font-bold leading-none tracking-tight">
              {hydrated ? counts.get(status) : "—"}
            </p>
            <p className="mt-1.5 text-[12px] font-medium capitalize text-slate-500 dark:text-slate-400">
              {status}
            </p>
          </div>
        ))}
      </div>

      {/* Requests table */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
        className={cn(pharmacyCardCls, "mt-5 overflow-hidden")}
      >
        {sorted.length === 0 ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
            <EmptyIcon className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
              No stock requests yet — submit your first one.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                  <th scope="col" className="px-5 py-3 font-semibold">Request</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Qty</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Priority</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Submitted</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold sr-only">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {sorted.map((request) => (
                  <tr key={request.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-white/5">
                    <td className="max-w-[280px] px-5 py-3">
                      <p className="truncate font-semibold text-slate-900 dark:text-white">{request.item}</p>
                      <p className="font-mono text-[12px] text-slate-500 dark:text-slate-400">{request.id}</p>
                    </td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums">{request.qty}</td>
                    <td className="px-3 py-3">
                      <StatusPill status={request.priority} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300">
                      {formatDay(request.submittedAt)}
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={request.status} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      {request.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => onCancel(request)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-2.5 py-1.5 text-[12px] font-semibold text-rose-600 transition-colors hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
                        >
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {hydrated && (
        <p className="mt-3 text-[12px] text-slate-400 dark:text-slate-500">
          {visible.length} requests in this store view · newest first · changes persist on this device
        </p>
      )}

      <NewRequestDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        requests={visible}
        onCreated={onCreated}
        actor={actor}
        storeId={storeId}
      />
    </div>
  );
}
