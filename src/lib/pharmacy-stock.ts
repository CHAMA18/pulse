/* Pure stock-flow helpers shared by the pharmacy console and its tests.
   No browser or React imports — safe to load under `node --test`. */

export type ReceivedLine = {
  name: string;
  qty: number;
  /** Supplier cost, when known. */
  unitCost?: number;
  productId?: string;
  /** Exact warehouse batch and expiry carried on a hub transfer. */
  batch?: string;
  expiry?: string;
  /** Duniya markup for this line; unset means the standard 20%. */
  markupPercent?: number;
  /** Pharmacy's chosen shelf price, applied when goods are received. */
  retailPrice?: number;
};

export type ShelfItem = {
  id: string;
  name: string;
  category: string;
  batch: string;
  expiry: string;
  qty: number;
  reorderLevel: number;
  /** Retail shelf price. */
  unitPrice: number;
  /** Supplier cost; optional on legacy rows. */
  costPrice?: number;
  /** Duniya markup; optional on legacy rows (defaults to 20%). */
  markupPercent?: number;
  storeId?: string;
  productId?: string;
};

/** Tenant-scoped storage key: one pharmacy's data never shares a key with another's. */
export function scopedStorageKey(base: string, scope: string | null | undefined): string {
  const clean = (scope ?? "").trim();
  return clean ? `${base}:${clean}` : base;
}

/** Parses a delivery items string ("A × 2 · B × 3") into lines; falls back to one line. */
export function parseDeliveryItems(items: string, units: number): ReceivedLine[] {
  const parts = items.split("·").map((p) => p.trim()).filter(Boolean);
  const lines: ReceivedLine[] = [];
  for (const part of parts) {
    const match = part.match(/^(.*?)\s*[×x]\s*(\d+)$/);
    if (match) lines.push({ name: match[1].trim(), qty: Number.parseInt(match[2], 10) });
  }
  if (lines.length > 0) return lines;
  const name = items.trim();
  return name ? [{ name, qty: Math.max(1, units || 1) }] : [];
}

/**
 * Credits received lines onto shelves: an existing batch for the same product
 * in the same store is topped up, otherwise a new receipt batch is created.
 * Returns the new shelf list plus one receipt entry per credited line.
 */
export function creditReceivedStock<T extends ShelfItem>(
  items: T[],
  lines: ReceivedLine[],
  storeId: string,
  now: number,
  makeId: (_index: number) => string
): { items: T[]; credited: { itemId: string; name: string; qty: number; batch: string }[] } {
  const next = items.map((item) => ({ ...item }));
  const credited: { itemId: string; name: string; qty: number; batch: string }[] = [];
  lines.forEach((line, index) => {
    if (!line.name || line.qty <= 0) return;
    const existing = next.find(
      (item) =>
        (item.storeId ?? "st-main") === storeId &&
        (line.productId ? item.productId === line.productId || item.name === line.name : item.name === line.name)
    );
    if (existing) {
      existing.qty += line.qty;
      if (line.productId && !existing.productId) existing.productId = line.productId;
      if (line.unitCost !== undefined) existing.costPrice = line.unitCost;
      if (line.markupPercent !== undefined) existing.markupPercent = line.markupPercent;
      if (line.retailPrice !== undefined && line.retailPrice > 0) {
        existing.unitPrice = line.retailPrice;
      }
      credited.push({ itemId: existing.id, name: existing.name, qty: line.qty, batch: existing.batch });
      return;
    }
    const batch = line.batch?.trim() || `RCV-${now}-${index + 1}`;
    const created = {
      id: makeId(index),
      name: line.name,
      category: "General",
      batch,
      expiry:
        line.expiry?.trim() ||
        new Date(now + 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      qty: line.qty,
      reorderLevel: Math.max(1, Math.round(line.qty * 0.25)),
      unitPrice: line.retailPrice ?? line.unitCost ?? 0,
      ...(line.unitCost !== undefined ? { costPrice: line.unitCost } : {}),
      ...(line.markupPercent !== undefined ? { markupPercent: line.markupPercent } : {}),
      storeId,
      ...(line.productId ? { productId: line.productId } : {}),
    } as T;
    next.push(created);
    credited.push({ itemId: created.id, name: created.name, qty: line.qty, batch });
  });
  return { items: next, credited };
}

export type StockRequestStatus =
  | "pending"
  | "approved"
  | "dispatched"
  | "delivered"
  | "rejected"
  | "cancelled";
export type StockRequestAction = "approve" | "dispatch" | "deliver" | "cancel" | "reject";

const REQUEST_TRANSITIONS: Record<StockRequestStatus, Partial<Record<StockRequestAction, StockRequestStatus>>> = {
  pending: { approve: "approved", cancel: "cancelled", reject: "rejected" },
  approved: { dispatch: "dispatched", cancel: "cancelled", reject: "rejected" },
  dispatched: { deliver: "delivered" },
  delivered: {},
  rejected: {},
  cancelled: {},
};

/** Next request status for a hub action, or null when the transition is not allowed. */
export function nextRequestStatus(
  current: StockRequestStatus,
  action: StockRequestAction
): StockRequestStatus | null {
  return REQUEST_TRANSITIONS[current]?.[action] ?? null;
}

/**
 * The quantity at which an item counts as low: the pharmacy's configured
 * trigger limit, raised by the item's own reorder level when that is higher
 * (a shelf flagged to reorder at 40 must not wait for the global 10).
 */
export function lowStockLimitFor(item: Pick<ShelfItem, "reorderLevel">, triggerLimit: number): number {
  const configured = Math.max(0, Math.round(Number(triggerLimit) || 0));
  const reorder = Math.max(0, Math.round(Number(item.reorderLevel) || 0));
  return Math.max(configured, reorder);
}

/**
 * The trigger limit for a store: its own setting when it has one, otherwise
 * the account-wide default. Branches keep different reorder rhythms.
 */
export function storeLowStockLimit(
  store: { lowStockThreshold?: number } | undefined,
  defaultLimit: number
): number {
  const own = Number(store?.lowStockThreshold);
  if (Number.isFinite(own) && own >= 0 && store?.lowStockThreshold !== undefined) {
    return Math.round(own);
  }
  return Math.max(0, Math.round(Number(defaultLimit) || 0));
}

/**
 * Items that have reached the low-stock trigger, worst first. Pass a number for
 * one account-wide limit, or a resolver when each store carries its own.
 */
export function triggeredLowStock<T extends ShelfItem>(
  items: T[],
  triggerLimit: number | ((_item: T) => number)
): T[] {
  const limitOf = typeof triggerLimit === "function" ? triggerLimit : () => triggerLimit;
  return items
    .filter((item) => item.qty <= lowStockLimitFor(item, limitOf(item)))
    .sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));
}

/** True when a sale containing prescription items may be charged. */
export function canChargePrescription(input: {
  hasPrescriptionItems: boolean;
  patientName: string;
  prescriptionVerified: boolean;
}): boolean {
  if (!input.hasPrescriptionItems) return true;
  return input.patientName.trim().length > 1 && input.prescriptionVerified;
}
