"use client";

import { motion } from "framer-motion";
import {
  AlertCircle,
  ClipboardList,
  FileDown,
  PackagePlus,
  Plus,
  Trash2,
  Upload,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  creditReceivedLines,
  DEFAULT_STORE_ID,
  formatDay,
  loadInventory,
  loadStockRequests,
  nextId,
  resolveStoreId,
  saveStockRequests,
  type InventoryItem,
  type RequestPriority,
  type RequestStatus,
  type StockRequest,
} from "@/components/pharmacy/pharmacy-data";
import { nextRequestStatus, type StockRequestAction } from "@/lib/pharmacy-stock";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

type LineErrors = {
  item?: string;
  qty?: string;
};

/** One row in the request dialog — an inventory item and the units needed. */
type RequestLine = { key: string; item: string; qty: string };

const MIN_QTY = 1;
const MAX_QTY = 10000;

const newLine = (): RequestLine => ({
  key: `line-${Math.random().toString(36).slice(2, 9)}`,
  item: "",
  qty: "",
});

/**
 * "item,quantity" CSV → rows. A header row is optional and tolerant of the
 * usual aliases (product/name, qty/units), because spreadsheets rarely agree.
 */
function parseRequestCsv(text: string): { item: string; qty: string }[] {
  const rows: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (quoted) {
        if (ch === '"' && raw[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        cells.push(cell);
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    rows.push(cells.map((entry) => entry.trim()));
  }
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.toLowerCase());
  const itemIndex = header.findIndex((cell) =>
    ["item", "items", "product", "products", "product name", "name"].includes(cell)
  );
  const qtyIndex = header.findIndex((cell) =>
    ["qty", "quantity", "units", "unit count", "count"].includes(cell)
  );
  const hasHeader = itemIndex >= 0 && qtyIndex >= 0;

  return (hasHeader ? rows.slice(1) : rows)
    .map((cells) => ({
      item: (cells[hasHeader ? itemIndex : 0] ?? "").trim(),
      qty: (cells[hasHeader ? qtyIndex : 1] ?? "").trim(),
    }))
    .filter((row) => row.item.length > 0);
}

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
  onCreated: (requests: StockRequest[]) => void;
  actor: { name: string; email: string };
  /** Destination store for the request ("all" records into the main store). */
  storeId: string;
}) {
  const { toast } = useToast();

  const [lines, setLines] = useState<RequestLine[]>([newLine()]);
  const [priority, setPriority] = useState<RequestPriority>("routine");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, LineErrors>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Shelves are read when the dialog opens so the dropdown always lists what
  // this pharmacy actually holds — never a free-text guess.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setInventory(loadInventory()));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const itemOptions = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of inventory) totals.set(entry.name, (totals.get(entry.name) ?? 0) + entry.qty);
    return [...totals.entries()]
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory]);

  const onHandOf = (name: string) =>
    itemOptions.find((option) => option.name === name)?.qty ?? 0;

  // Reopening starts a fresh form (render-time reset, like the register dialog).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setLines([newLine()]);
      setPriority("routine");
      setNotes("");
      setErrors({});
      setFormError(null);
    }
  }

  const updateLine = (key: string, patch: Partial<RequestLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const addLine = () => setLines((prev) => [...prev, newLine()]);

  const removeLine = (key: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.key !== key)));

  /** The − / + count controller: empty steps to 1, values stay inside range. */
  const stepLine = (key: string, delta: number) =>
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const current = Number.parseInt(line.qty, 10);
        const base = Number.isFinite(current) ? current : 0;
        const nextQty = Math.min(MAX_QTY, Math.max(MIN_QTY, base + delta));
        return { ...line, qty: String(nextQty) };
      })
    );

  const validate = (): Record<string, LineErrors> => {
    const next: Record<string, LineErrors> = {};
    const seen = new Set<string>();
    for (const line of lines) {
      // A row left completely blank is simply ignored, so adding a second line
      // and changing your mind does not block the request.
      if (!line.item.trim() && !line.qty.trim()) continue;
      const entry: LineErrors = {};
      const name = line.item.trim();
      const key = name.toLowerCase();
      if (!name) {
        entry.item = "Choose an item from your inventory.";
      } else if (seen.has(key)) {
        entry.item = "This item is already on the request.";
      } else {
        seen.add(key);
        const pending = requests.find(
          (r) => r.status === "pending" && r.item.toLowerCase() === key
        );
        if (pending) entry.item = `Already pending as ${pending.id}.`;
      }
      const parsed = Number.parseInt(line.qty, 10);
      if (!line.qty.trim() || !Number.isFinite(parsed) || parsed < MIN_QTY)
        entry.qty = "At least one unit.";
      else if (parsed > MAX_QTY) entry.qty = `Max ${MAX_QTY.toLocaleString()} per line.`;
      if (entry.item || entry.qty) next[line.key] = entry;
    }
    return next;
  };

  const submit = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const filled = lines.filter((line) => line.item.trim());
    if (filled.length === 0) {
      setFormError("Add at least one item to request.");
      return;
    }

    const created: StockRequest[] = [];
    let pool = requests;
    for (const line of filled) {
      const request: StockRequest = {
        id: nextId(pool, "REQ"),
        item: line.item.trim(),
        qty: Number.parseInt(line.qty, 10),
        priority,
        status: "pending",
        submittedAt: Date.now(),
        ...(storeId !== "all" ? { storeId } : {}),
      };
      created.push(request);
      pool = [request, ...pool];
    }

    onCreated(created);
    toast({
      title:
        created.length === 1
          ? "Stock request submitted"
          : `${created.length} stock requests submitted`,
      description:
        created.length === 1
          ? `${created[0].item} × ${created[0].qty} is with the Pulse hub for approval.`
          : `${created.reduce((acc, request) => acc + request.qty, 0)} units across ${created.length} items are with the Pulse hub for approval.`,
    });
    if (actor.email) {
      recordAudit({
        title: "Stock Requested",
        action: "Update",
        detail: created
          .map((request) => `${request.id} · ${request.item} × ${request.qty}`)
          .join(" | "),
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_stock_requested", {
      priority,
      qty: created.reduce((acc, request) => acc + request.qty, 0),
      lines: created.length,
    });
    onOpenChange(false);
  };

  /** Matches CSV rows against real inventory so a request never invents an item. */
  const importCsv = async (file: File) => {
    try {
      const rows = parseRequestCsv(await file.text());
      if (rows.length === 0) {
        setFormError("That file had no rows — expected item,quantity.");
        return;
      }
      const byName = new Map(itemOptions.map((option) => [option.name.toLowerCase(), option.name]));
      const imported: RequestLine[] = [];
      const missing: string[] = [];
      for (const row of rows) {
        const canonical = byName.get(row.item.toLowerCase());
        if (!canonical) {
          missing.push(row.item);
          continue;
        }
        const qty = Math.round(Number(row.qty) || 0);
        imported.push({
          ...newLine(),
          item: canonical,
          qty: String(Math.min(MAX_QTY, Math.max(MIN_QTY, qty))),
        });
      }
      if (imported.length === 0) {
        setFormError(
          `${rows.length} row${rows.length === 1 ? "" : "s"} read, but none matched your inventory items.`
        );
        return;
      }
      setLines((prev) => [...prev.filter((line) => line.item.trim()), ...imported]);
      setErrors({});
      setFormError(null);
      toast({
        title: `${imported.length} line${imported.length === 1 ? "" : "s"} imported`,
        description: missing.length
          ? `${missing.length} skipped — not in inventory (e.g. ${missing[0]}). Review the quantities, then submit.`
          : "Review the quantities, then submit the request.",
      });
      void trackEvent("pharmacy_stock_request_csv_import", {
        lines: imported.length,
        skipped: missing.length,
      });
    } catch {
      setFormError("That file could not be read. Export it as CSV and try again.");
    }
  };

  const downloadTemplate = () => {
    const sample = itemOptions.slice(0, 3);
    const rows = [
      "item,quantity",
      ...(sample.length > 0
        ? sample.map((option) => `${option.name},10`)
        : ["Coartem 20/60 (pack),40"]),
    ];
    const blob = new Blob([`\uFEFF${rows.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "stock-request-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl p-6 sm:max-w-[560px]">
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            Request stock
          </DialogTitle>
          <DialogDescription className="text-[13.5px] text-slate-500 dark:text-slate-400">
            Send a replenishment request to the Pulse hub — approved items arrive with your next
            delivery.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
          {/* Multi-line toolbar + CSV import */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">
              {lines.length} item{lines.length === 1 ? "" : "s"} on this request
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-purple-700 transition-colors hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Import .CSV
              </button>
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                Template
              </button>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importCsv(file);
              event.target.value = "";
            }}
          />

          {/* One row per item, each with its own count controller */}
          {lines.map((line, index) => {
            const lineErrors = errors[line.key] ?? {};
            const onHand = onHandOf(line.item);
            return (
              <div
                key={line.key}
                className="rounded-xl border border-slate-200 p-3 dark:border-white/10"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`request-item-${line.key}`}
                      className="mb-1.5 block text-[12.5px] font-semibold text-slate-700 dark:text-slate-200"
                    >
                      Item
                      {lines.length > 1 && (
                        <span className="ml-1.5 font-normal text-slate-400">#{index + 1}</span>
                      )}
                    </label>
                    <Select
                      value={line.item}
                      onValueChange={(value) => {
                        updateLine(line.key, { item: value });
                        setErrors((prev) => ({ ...prev, [line.key]: {} }));
                        setFormError(null);
                      }}
                    >
                      <SelectTrigger
                        id={`request-item-${line.key}`}
                        aria-invalid={!!lineErrors.item}
                        className={cn(
                          "h-11 w-full bg-white dark:bg-white/5",
                          lineErrors.item && "border-rose-300 focus:ring-rose-500/10"
                        )}
                      >
                        <SelectValue placeholder="Choose an inventory item" />
                      </SelectTrigger>
                      <SelectContent>
                        {itemOptions.map((option) => (
                          <SelectItem key={option.name} value={option.name}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {lineErrors.item ? (
                      <p role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
                        <AlertCircle className="h-3.5 w-3.5" /> {lineErrors.item}
                      </p>
                    ) : (
                      line.item && (
                        <p className="mt-1 text-[11.5px] text-slate-400 dark:text-slate-500">
                          {onHand === 0
                            ? "None on hand — request replenishment."
                            : `${onHand} on hand now.`}
                        </p>
                      )
                    )}
                  </div>

                  <div className="w-[148px] shrink-0">
                    <label
                      htmlFor={`request-qty-${line.key}`}
                      className="mb-1.5 block text-[12.5px] font-semibold text-slate-700 dark:text-slate-200"
                    >
                      Quantity
                    </label>
                    <div
                      className={cn(
                        "flex h-11 items-stretch overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-white/5",
                        lineErrors.qty && "border-rose-300"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => stepLine(line.key, -1)}
                        aria-label={`Decrease quantity for item ${index + 1}`}
                        className="w-9 shrink-0 text-[16px] font-bold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-white/10"
                        disabled={Number.parseInt(line.qty, 10) <= MIN_QTY}
                      >
                        −
                      </button>
                      <input
                        id={`request-qty-${line.key}`}
                        type="number"
                        min={MIN_QTY}
                        max={MAX_QTY}
                        inputMode="numeric"
                        value={line.qty}
                        placeholder="0"
                        onChange={(event) => {
                          updateLine(line.key, { qty: event.target.value });
                          setErrors((prev) => ({ ...prev, [line.key]: {} }));
                        }}
                        aria-label={`Quantity for item ${index + 1}`}
                        className="w-full min-w-0 border-x border-slate-200 bg-transparent text-center text-[14px] font-semibold tabular-nums text-slate-900 outline-none dark:border-white/10 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => stepLine(line.key, 1)}
                        aria-label={`Increase quantity for item ${index + 1}`}
                        className="w-9 shrink-0 text-[16px] font-bold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-white/10"
                        disabled={Number.parseInt(line.qty, 10) >= MAX_QTY}
                      >
                        +
                      </button>
                    </div>
                    {lineErrors.qty && (
                      <p role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
                        <AlertCircle className="h-3.5 w-3.5" /> {lineErrors.qty}
                      </p>
                    )}
                  </div>

                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      aria-label={`Remove item ${index + 1}`}
                      className="mt-6 flex h-11 w-10 shrink-0 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addLine}
            className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-purple-700 transition-colors hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add another item
          </button>

          {itemOptions.length === 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              No inventory items yet — add products in the Catalogue, then request stock here.
            </p>
          )}

          {formError && (
            <p
              role="alert"
              className="flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {formError}
            </p>
          )}

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
            disabled={itemOptions.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:opacity-50"
          >
            <PackagePlus className="h-4 w-4" aria-hidden="true" />
            {(() => {
              const filled = lines.filter((line) => line.item.trim()).length;
              return filled > 1 ? `Submit ${filled} requests` : "Submit request";
            })()}
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

  const onCreated = (created: StockRequest[]) => {
    persist([...created, ...requests]);
  };

  /** Hub lifecycle: approve → dispatch → deliver. Delivery credits the shelf. */
  const onHubAction = (request: StockRequest, action: StockRequestAction) => {
    const next = nextRequestStatus(request.status, action);
    if (!next) return;
    persist(requests.map((r) => (r.id === request.id ? { ...r, status: next } : r)));
    if (next === "delivered") {
      const credited = creditReceivedLines(
        [{ name: request.item, qty: request.qty }],
        request.storeId ?? DEFAULT_STORE_ID,
        actor,
        "Central hub restock"
      );
      toast({
        title: "Request delivered",
        description: `${credited} units of ${request.item} are now on the shelf.`,
      });
    } else {
      toast({ title: `Request ${next}`, description: `${request.id} · ${request.item}` });
    }
    if (actor.email) {
      recordAudit({
        title: `Stock Request ${next}`,
        action: "Update",
        detail: `${request.id} · ${request.item} × ${request.qty}`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_stock_request_transition", { request: request.id, to: next });
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
                      <span className="inline-flex flex-wrap justify-end gap-1.5">
                        {request.status === "pending" && (
                          <button type="button" onClick={() => onHubAction(request, "approve")} className="inline-flex items-center rounded-md border border-violet-200 px-2.5 py-1.5 text-[12px] font-semibold text-violet-600 transition-colors hover:bg-violet-50 dark:border-violet-500/30 dark:text-violet-300 dark:hover:bg-violet-500/10">Hub: approve</button>
                        )}
                        {request.status === "approved" && (
                          <button type="button" onClick={() => onHubAction(request, "dispatch")} className="inline-flex items-center rounded-md border border-purple-200 px-2.5 py-1.5 text-[12px] font-semibold text-purple-600 transition-colors hover:bg-purple-50 dark:border-purple-500/30 dark:text-purple-300 dark:hover:bg-purple-500/10">Hub: dispatch</button>
                        )}
                        {request.status === "dispatched" && (
                          <button type="button" onClick={() => onHubAction(request, "deliver")} className="inline-flex items-center rounded-md border border-emerald-200 px-2.5 py-1.5 text-[12px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10">Deliver to shelf</button>
                        )}
                        {(request.status === "pending" || request.status === "approved") && (
                          <button
                            type="button"
                            onClick={() => onCancel(request)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-2.5 py-1.5 text-[12px] font-semibold text-rose-600 transition-colors hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
                          >
                            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            Cancel
                          </button>
                        )}
                      </span>
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
