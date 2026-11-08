"use client";

import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ClipboardPen,
  Minus,
  PackageSearch,
  Plus,
  Repeat,
  Search,
  SearchX,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  MOVEMENT_REASONS,
  MOVEMENT_TYPE_META,
  formatZMW,
  loadInventory,
  loadMovements,
  nextMovementId,
  resolveStoreId,
  saveInventory,
  saveMovements,
  type InventoryItem,
  type MovementType,
  type PharmacyStore,
  type StockMovement,
} from "@/components/pharmacy/pharmacy-data";
import {
  PageHeader,
  pharmacyCardCls,
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
/* Filters                                                             */
/* ------------------------------------------------------------------ */

type MovementFilter = "all" | MovementType;

const FILTERS: { id: MovementFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "receipt", label: "Receipts" },
  { id: "issue", label: "Issues" },
  { id: "transfer", label: "Transfers" },
  { id: "adjustment", label: "Adjustments" },
  { id: "return", label: "Returns" },
];

const TYPE_ICON: Record<MovementType, LucideIcon> = {
  receipt: ArrowDownLeft,
  issue: ArrowUpRight,
  transfer: ArrowLeftRight,
  adjustment: ClipboardPen,
  return: Repeat,
};

const TYPE_PILL: Record<MovementType, string> = {
  receipt: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  issue: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  transfer: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  adjustment: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  return: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
};

function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-[128px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
      <p className="text-[18px] font-bold leading-none tracking-tight">{value}</p>
      <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

function TypePill({ type }: { type: MovementType }) {
  const Icon = TYPE_ICON[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
        TYPE_PILL[type]
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
      {MOVEMENT_TYPE_META[type].label}
    </span>
  );
}

/** Signed quantity cell — green in, amber out, sky moves. */
function QtyCell({ qty, type }: { qty: number; type: MovementType }) {
  const positive = qty > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-bold tabular-nums",
        type === "transfer"
          ? "text-sky-600 dark:text-sky-400"
          : positive
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-amber-600 dark:text-amber-400"
      )}
    >
      {qty > 0 ? `+${qty}` : qty}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Record movement dialog                                              */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000;

function RecordMovementDialog({
  open,
  onOpenChange,
  items,
  stores,
  onRecord,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: InventoryItem[];
  stores: PharmacyStore[];
  onRecord: (input: {
    type: MovementType;
    item: InventoryItem;
    qty: number;
    direction: "in" | "out";
    toStoreId?: string;
    reason: string;
    note: string;
  }) => void;
}) {
  const [type, setType] = useState<MovementType>("adjustment");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [toStoreId, setToStoreId] = useState("");
  const [reason, setReason] = useState(MOVEMENT_REASONS.adjustment[0]);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reopening starts a fresh form (reset during render — React-documented
  // alternative to a reset effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setType("adjustment");
      setItemId("");
      setQty("1");
      setDirection("in");
      setToStoreId("");
      setReason(MOVEMENT_REASONS.adjustment[0]);
      setNote("");
      setErrors({});
    }
  }

  const storeName = (id?: string) =>
    id === undefined ? "Main store" : (stores.find((store) => store.id === id)?.name ?? "Main store");

  /** The shelf a movement starts from is the item's own store. */
  const selectedItem = items.find((entry) => entry.id === itemId);
  const sourceStoreId = selectedItem ? resolveStoreId(selectedItem) : undefined;

  const submit = () => {
    const next: Record<string, string> = {};
    if (!selectedItem) next.item = "Choose the product this movement is against.";
    const parsedQty = Number.parseInt(qty, 10);
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) next.qty = "Enter a quantity of at least 1.";
    if (type === "transfer") {
      if (!toStoreId) next.toStore = "Choose the destination store.";
      else if (toStoreId === sourceStoreId) next.toStore = "Pick a store different from the source.";
      else if (selectedItem && parsedQty > selectedItem.qty)
        next.qty = `Only ${selectedItem.qty} on the source shelf.`;
    }
    if (type === "issue" && selectedItem && parsedQty > selectedItem.qty) {
      next.qty = `Only ${selectedItem.qty} on the shelf.`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !selectedItem) return;

    onRecord({
      type,
      item: selectedItem,
      qty: parsedQty,
      // Adjustments & returns can go either way; receipts are always in,
      // issues always out.
      direction: type === "receipt" ? "in" : type === "issue" ? "out" : direction,
      toStoreId: type === "transfer" ? toStoreId : undefined,
      reason,
      note: note.trim(),
    });
  };

  const fieldCls =
    "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[13.5px] text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white";
  const labelCls = "mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200";
  const errorCls = (key: string) =>
    errors[key] ? <p className="mt-1 text-xs font-medium text-rose-600">{errors[key]}</p> : null;

  const showDirection = type === "adjustment" || type === "return";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-2xl sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            Record stock movement
          </DialogTitle>
          <DialogDescription className="text-[13px] text-slate-500 dark:text-slate-400">
            Every quantity change flows through this ledger — the shelf updates the moment you
            record.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Type */}
          <div>
            <span className={labelCls}>Movement type</span>
            <div role="radiogroup" aria-label="Movement type" className="flex flex-wrap gap-1.5">
              {(Object.keys(MOVEMENT_TYPE_META) as MovementType[]).map((id) => {
                const active = type === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setType(id);
                      setReason(MOVEMENT_REASONS[id][0]);
                      setErrors({});
                    }}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                      active
                        ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                        : "bg-slate-100 text-slate-600 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                    )}
                  >
                    {MOVEMENT_TYPE_META[id].label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
              {MOVEMENT_TYPE_META[type].hint}
            </p>
          </div>

          {/* Product */}
          <div>
            <label htmlFor="movement-item" className={labelCls}>
              Product &amp; batch
            </label>
            <select
              id="movement-item"
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                if (errors.item) setErrors((p) => ({ ...p, item: "" }));
              }}
              className={fieldCls}
            >
              <option value="">Choose a product…</option>
              {items.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {entry.batch} · {entry.qty} on shelf ({storeName(resolveStoreId(entry))})
                </option>
              ))}
            </select>
            {errorCls("item")}
            {selectedItem && (
              <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                Source shelf: {storeName(sourceStoreId)} · {selectedItem.qty} units ·{" "}
                {formatZMW(selectedItem.unitPrice)} each
              </p>
            )}
          </div>

          {/* Quantity + direction */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="movement-qty" className={labelCls}>
                Quantity
              </label>
              <input
                id="movement-qty"
                type="number"
                min={1}
                inputMode="numeric"
                value={qty}
                onChange={(e) => {
                  setQty(e.target.value);
                  if (errors.qty) setErrors((p) => ({ ...p, qty: "" }));
                }}
                className={fieldCls}
              />
              {errorCls("qty")}
            </div>
            {showDirection && (
              <div>
                <span className={labelCls}>Direction</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    aria-pressed={direction === "in"}
                    onClick={() => setDirection("in")}
                    className={cn(
                      "inline-flex h-10 items-center justify-center gap-1.5 rounded-md border text-[13px] font-semibold transition-colors",
                      direction === "in"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/5"
                    )}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Into shelf
                  </button>
                  <button
                    type="button"
                    aria-pressed={direction === "out"}
                    onClick={() => setDirection("out")}
                    className={cn(
                      "inline-flex h-10 items-center justify-center gap-1.5 rounded-md border text-[13px] font-semibold transition-colors",
                      direction === "out"
                        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/5"
                    )}
                  >
                    <Minus className="h-4 w-4" aria-hidden="true" /> Off shelf
                  </button>
                </div>
              </div>
            )}
            {type === "transfer" && (
              <div>
                <label htmlFor="movement-store" className={labelCls}>
                  Destination store
                </label>
                <select
                  id="movement-store"
                  value={toStoreId}
                  onChange={(e) => {
                    setToStoreId(e.target.value);
                    if (errors.toStore) setErrors((p) => ({ ...p, toStore: "" }));
                  }}
                  className={fieldCls}
                >
                  <option value="">Choose a store…</option>
                  {stores
                    .filter((store) => store.id !== sourceStoreId)
                    .map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                        {store.isMain ? " (main)" : ""}
                      </option>
                    ))}
                </select>
                {errorCls("toStore")}
              </div>
            )}
          </div>

          {/* Reason + note */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="movement-reason" className={labelCls}>
                Reason
              </label>
              <select
                id="movement-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={fieldCls}
              >
                {MOVEMENT_REASONS[type].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="movement-note" className={labelCls}>
                Note <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="movement-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Invoice #, reference, context…"
                className={fieldCls}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 items-center justify-center rounded-md px-4 text-[13.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-5 text-[13.5px] font-semibold text-white",
              "shadow-[0_8px_22px_-8px_rgba(147,51,234,0.65)] transition-shadow hover:shadow-[0_12px_28px_-8px_rgba(147,51,234,0.8)]"
            )}
          >
            <ClipboardPen className="h-4 w-4" aria-hidden="true" />
            Record movement
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PharmacyStockMovement({
  storeId = "all",
  stores = [],
  actor = { name: "Pharmacy Owner", email: "" },
}: {
  storeId?: string;
  stores?: PharmacyStore[];
  actor?: { name: string; email: string };
}) {
  const { toast } = useToast();

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MovementFilter>("all");
  const [recordOpen, setRecordOpen] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setMovements(loadMovements());
      setItems(loadInventory());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  /** A movement touches the store view when either end of the route matches. */
  const inStoreView = (movement: StockMovement) => {
    if (storeId === "all") return true;
    return movement.fromStoreId === storeId || movement.toStoreId === storeId;
  };

  const visible = useMemo(() => movements.filter(inStoreView), [movements, storeId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visible
      .filter((entry) => filter === "all" || entry.type === filter)
      .filter(
        (entry) =>
          !q ||
          entry.productName.toLowerCase().includes(q) ||
          entry.batch.toLowerCase().includes(q) ||
          entry.reason.toLowerCase().includes(q) ||
          entry.id.toLowerCase().includes(q)
      )
      .sort((a, b) => b.at - a.at);
  }, [visible, query, filter]);

  // 7-day flow stats for the store view.
  const week = visible.filter((entry) => entry.at >= Date.now() - 7 * DAY);
  const unitsIn = week
    .filter((entry) => entry.type === "receipt" || (entry.type === "return" && entry.qty > 0) || (entry.type === "adjustment" && entry.qty > 0))
    .reduce((acc, entry) => acc + Math.abs(entry.qty), 0);
  const unitsOut = week
    .filter((entry) => entry.type === "issue" || entry.qty < 0)
    .reduce((acc, entry) => acc + Math.abs(entry.qty), 0);
  const net = week.reduce((acc, entry) => {
    if (entry.type === "transfer") return acc; // transfers move, not grow
    return acc + entry.qty;
  }, 0);

  const storeName = (id?: string) =>
    id ? (stores.find((store) => store.id === id)?.name ?? "Store") : "Main store";

  /** Persist the ledger entry + apply it to the shelves. */
  const record = (input: {
    type: MovementType;
    item: InventoryItem;
    qty: number;
    direction: "in" | "out";
    toStoreId?: string;
    reason: string;
    note: string;
  }) => {
    if (!hydrated) return;

    const signed =
      input.type === "receipt"
        ? Math.abs(input.qty)
        : input.type === "issue"
          ? -Math.abs(input.qty)
          : input.direction === "in"
            ? Math.abs(input.qty)
            : -Math.abs(input.qty);

    const entry: StockMovement = {
      id: nextMovementId(movements),
      at: Date.now(),
      type: input.type,
      itemId: input.item.id,
      productName: input.item.name,
      batch: input.item.batch,
      qty: signed,
      fromStoreId: resolveStoreId(input.item),
      toStoreId: input.toStoreId,
      reason: input.reason,
      note: input.note || undefined,
      actor: { name: actor.name || "Pharmacy Owner", email: actor.email },
    };

    // Apply to the shelves: source first, then the transfer destination.
    let nextItems = items.map((row) =>
      row.id === input.item.id
        ? { ...row, qty: Math.max(0, row.qty + signed) }
        : row
    );

    if (input.type === "transfer" && input.toStoreId) {
      // Reduce already applied; add the stock to the destination shelf —
      // reusing an existing row of the same product+batch when there is one.
      const remaining = Math.max(0, input.item.qty - Math.abs(signed));
      const twin = nextItems.find(
        (row) =>
          row.id !== input.item.id &&
          row.name === input.item.name &&
          row.batch === input.item.batch &&
          resolveStoreId(row) === input.toStoreId
      );
      if (twin) {
        nextItems = nextItems.map((row) =>
          row.id === twin.id ? { ...row, qty: row.qty + remaining } : row
        );
      } else {
        const created: InventoryItem = {
          id: `inv-${Date.now().toString(36)}`,
          name: input.item.name,
          category: input.item.category,
          batch: input.item.batch,
          expiry: input.item.expiry,
          qty: remaining,
          reorderLevel: input.item.reorderLevel,
          unitPrice: input.item.unitPrice,
          storeId: input.toStoreId,
        };
        nextItems = [...nextItems, created];
      }
    }

    setMovements((prev) => [entry, ...prev]);
    saveMovements([entry, ...movements]);
    setItems(nextItems);
    saveInventory(nextItems);
    setRecordOpen(false);

    toast({
      title: `${MOVEMENT_TYPE_META[input.type].label} recorded — ${entry.id}`,
      description: `${input.item.name} ${signed > 0 ? "+" : ""}${signed} · shelf updated.`,
    });
    if (actor.email) {
      recordAudit({
        title: "Stock Movement Recorded",
        action: "Create",
        detail: `${MOVEMENT_TYPE_META[input.type].label} · ${input.item.name} ${signed > 0 ? "+" : ""}${signed} (${input.reason})`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_stock_movement", { type: input.type, qty: signed });
  };

  const FilterIcon: LucideIcon = filter === "all" ? SearchX : PackageSearch;

  return (
    <div aria-labelledby="pharmacy-movement-title">
      <PageHeader
        icon={ArrowLeftRight}
        title="Stock Movement"
        subtitle="Every receipt, issue, transfer and quantity adjustment — one auditable ledger"
        tourId="ph-movement"
        actions={
          <button
            type="button"
            onClick={() => setRecordOpen(true)}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white",
              "shadow-[0_8px_22px_-8px_rgba(147,51,234,0.65)] transition-shadow hover:shadow-[0_12px_28px_-8px_rgba(147,51,234,0.8)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
            )}
          >
            <ClipboardPen className="h-4 w-4" aria-hidden="true" />
            Record movement
          </button>
        }
      />
      <h2 id="pharmacy-movement-title" className="sr-only">
        Stock Movement
      </h2>

      {/* How it works — adjustments live here, not on Inventory */}
      <div
        className={cn(
          pharmacyCardCls,
          "mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-[13px]"
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
          <Warehouse className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-white">
            Quantities change here only.
          </span>{" "}
          The Inventory page is a read-only view of the shelves — record a movement above and the
          shelf updates instantly.
        </p>
      </div>

      {/* Stats */}
      <div className={cn(pharmacyCardCls, "mt-5 flex flex-wrap gap-3 p-4")}>
        <StatChip value={String(hydrated ? week.length : "—")} label="Movements · 7 days" />
        <StatChip value={hydrated ? `+${unitsIn}` : "—"} label="Units in · 7 days" />
        <StatChip value={hydrated ? `−${unitsOut}` : "—"} label="Units out · 7 days" />
        <StatChip
          value={hydrated ? `${net > 0 ? "+" : ""}${net}` : "—"}
          label="Net shelf change · 7 days"
        />
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
            placeholder="Search by product, batch, reason or reference…"
            aria-label="Search stock movements"
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
        <div
          role="radiogroup"
          aria-label="Filter by movement type"
          className="flex flex-wrap items-center gap-1.5"
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

      {/* Ledger */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
        className={cn(pharmacyCardCls, "mt-5 overflow-hidden")}
      >
        {filtered.length === 0 ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
            <FilterIcon className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
              No movements match {query.trim() ? `"${query.trim()}"` : "this filter"}.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="text-[13px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
            >
              Clear search &amp; filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                  <th scope="col" className="px-5 py-3 font-semibold">Reference</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Product</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Type</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Qty change</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Route</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Reason</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Recorded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((entry) => (
                  <tr
                    key={entry.id}
                    className="transition-colors hover:bg-slate-50/80 dark:hover:bg-white/5"
                  >
                    <td className="whitespace-nowrap px-5 py-3">
                      <p className="font-mono text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                        {entry.id}
                      </p>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">
                        {new Date(entry.at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </td>
                    <td className="max-w-[220px] px-3 py-3">
                      <p className="truncate font-semibold text-slate-900 dark:text-white">
                        {entry.productName}
                      </p>
                      <p className="font-mono text-[12px] text-slate-500 dark:text-slate-400">
                        {entry.batch}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <TypePill type={entry.type} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <QtyCell qty={entry.qty} type={entry.type} />
                    </td>
                    <td className="max-w-[200px] px-3 py-3">
                      {entry.type === "transfer" ? (
                        <p className="truncate text-slate-600 dark:text-slate-300">
                          {storeName(entry.fromStoreId)} → {storeName(entry.toStoreId)}
                        </p>
                      ) : (
                        <p className="truncate text-slate-600 dark:text-slate-300">
                          {storeName(entry.fromStoreId ?? entry.toStoreId)}
                        </p>
                      )}
                      {entry.note && (
                        <p className="truncate text-[12px] text-slate-400 dark:text-slate-500">
                          {entry.note}
                        </p>
                      )}
                    </td>
                    <td className="max-w-[180px] px-3 py-3">
                      <p className="truncate text-slate-600 dark:text-slate-300">{entry.reason}</p>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600 dark:text-slate-300">
                      {entry.actor.name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      <p className="mt-3 text-[12px] text-slate-400 dark:text-slate-500">
        Showing {filtered.length} of {visible.length} movements in this store view · the ledger
        persists on this device
      </p>

      <RecordMovementDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        items={items}
        stores={stores}
        onRecord={record}
      />
    </div>
  );
}
