/* Pulse Central Warehouse — one shelf stock, one movement ledger.
   The Warehouse Catalogue and the Pulse Stock Movements page both read and
   write through here, so the two views can never drift apart: every quantity
   change is a ledger entry, and every ledger entry moves a shelf.
   Pure logic only — safe under `node --test`. */

export type WarehouseMovementType = "receipt" | "issue" | "transfer" | "adjustment" | "return";

export type WarehouseItem = {
  id: string;
  name: string;
  category: string;
  batch: string;
  expiry: string;
  qty: number;
  reorderLevel: number;
  unitPrice: number;
  productId?: string;
};

export type WarehouseMovement = {
  id: string;
  at: number;
  type: WarehouseMovementType;
  itemId: string;
  productName: string;
  batch: string;
  /** Signed change applied to the warehouse shelf. */
  qty: number;
  reason: string;
  note?: string;
  /** Registered pharmacy the stock is going to (issues and transfers). */
  destinationPharmacyId?: string;
  destinationPharmacyName?: string;
  actor: { name: string; email: string };
};

export const WAREHOUSE_ITEMS_KEY = "pulse.warehouse-inventory.v1";
export const WAREHOUSE_MOVEMENTS_KEY = "pulse.warehouse-movements.v1";
export const WAREHOUSE_NAME = "Pulse Central Warehouse";

/** Shelf delta for a movement: receipts/returns in, issues/transfers out, adjustments signed as entered. */
export function movementDelta(type: WarehouseMovementType, qty: number): number {
  const magnitude = Math.abs(Math.round(qty) || 0);
  if (type === "receipt" || type === "return") return magnitude;
  if (type === "issue" || type === "transfer") return -magnitude;
  return Math.round(qty) || 0; // adjustment carries its own sign
}

/**
 * Applies one movement to the shelves and appends it to the ledger.
 * Returns null when the movement would drive a shelf below zero.
 */
export function applyWarehouseMovement(
  items: WarehouseItem[],
  movements: WarehouseMovement[],
  input: {
    type: WarehouseMovementType;
    itemId: string;
    qty: number;
    reason: string;
    note?: string;
    destinationPharmacyId?: string;
    destinationPharmacyName?: string;
    actor: { name: string; email: string };
    at: number;
    id: string;
  }
): { items: WarehouseItem[]; movement: WarehouseMovement } | null {
  const item = items.find((row) => row.id === input.itemId);
  if (!item) return null;
  const delta = movementDelta(input.type, input.qty);
  if (delta === 0) return null;
  if (item.qty + delta < 0) return null;
  const movement: WarehouseMovement = {
    id: input.id,
    at: input.at,
    type: input.type,
    itemId: item.id,
    productName: item.name,
    batch: item.batch,
    qty: delta,
    reason: input.reason,
    ...(input.note ? { note: input.note } : {}),
    ...(input.destinationPharmacyId ? { destinationPharmacyId: input.destinationPharmacyId } : {}),
    ...(input.destinationPharmacyName ? { destinationPharmacyName: input.destinationPharmacyName } : {}),
    actor: input.actor,
  };
  return {
    items: items.map((row) => (row.id === item.id ? { ...row, qty: row.qty + delta } : row)),
    movement,
  };
}

/** Next sequential warehouse movement id ("WHM-5001"). */
export function nextWarehouseMovementId(movements: WarehouseMovement[]): string {
  const max = movements.reduce((acc, entry) => {
    const n = Number.parseInt(entry.id.replace("WHM-", ""), 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 5000);
  return `WHM-${max + 1}`;
}

/* ------------------------------------------------------------------ */
/* Browser persistence (client only)                                   */
/* ------------------------------------------------------------------ */

function loadList<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function saveList<T>(key: string, list: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* best-effort */
  }
}

export function loadWarehouseItems(): WarehouseItem[] {
  return loadList<WarehouseItem>(WAREHOUSE_ITEMS_KEY);
}

export function saveWarehouseItems(items: WarehouseItem[]): void {
  saveList(WAREHOUSE_ITEMS_KEY, items);
}

export function loadWarehouseMovements(): WarehouseMovement[] {
  return loadList<WarehouseMovement>(WAREHOUSE_MOVEMENTS_KEY);
}

export function saveWarehouseMovements(movements: WarehouseMovement[]): void {
  saveList(WAREHOUSE_MOVEMENTS_KEY, movements);
}

/** Records a movement end-to-end (shelf + ledger). Returns the movement, or null if rejected. */
export function recordWarehouseMovement(input: {
  type: WarehouseMovementType;
  itemId: string;
  qty: number;
  reason: string;
  note?: string;
  destinationPharmacyId?: string;
  destinationPharmacyName?: string;
  actor: { name: string; email: string };
}): WarehouseMovement | null {
  const items = loadWarehouseItems();
  const movements = loadWarehouseMovements();
  const applied = applyWarehouseMovement(items, movements, {
    ...input,
    at: Date.now(),
    id: nextWarehouseMovementId(movements),
  });
  if (!applied) return null;
  saveWarehouseItems(applied.items);
  saveWarehouseMovements([applied.movement, ...movements]);
  return applied.movement;
}
