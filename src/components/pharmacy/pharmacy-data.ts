"use client";

import {
  PHARMACY_SCOPE_KEY,
  savePharmacyList,
  scopedPharmacyKey,
} from "@/components/pharmacy/pharmacy-shared";
import {
  creditReceivedStock,
  parseDeliveryItems,
  type ReceivedLine,
} from "@/lib/pharmacy-stock";

export { parseDeliveryItems };

/* ------------------------------------------------------------------ */
/* Pharmacy portal data model                                          */
/* ------------------------------------------------------------------ */
/* The operational records behind the Pharmacy portal console. Every   */
/* list is read from localStorage exactly as it was saved — no starter */
/* inventories, stores, sales or supplier fixtures are injected.       */
/* Inventory, requests and deliveries are recorded per store — the     */
/* account's main store is the declared home of the application.       */

export const PHARMACY_INVENTORY_KEY = "pulse.pharmacy-inventory.v1";
export const PHARMACY_REQUESTS_KEY = "pulse.pharmacy-requests.v1";
export const PHARMACY_DELIVERIES_KEY = "pulse.pharmacy-deliveries.v1";
export const PHARMACY_SETTINGS_KEY = "pulse.pharmacy-settings.v1";
export const PHARMACY_STORES_KEY = "pulse.pharmacy-stores.v1";
export const PHARMACY_CATALOGUE_KEY = "pulse.pharmacy-catalogue.v1";
export const PHARMACY_SALES_KEY = "pulse.pharmacy-sales.v1";
export const PHARMACY_PURCHASE_ORDERS_KEY = "pulse.pharmacy-purchase-orders.v1";
export const PHARMACY_SUPPLIERS_KEY = "pulse.pharmacy-suppliers.v1";

export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  batch: string;
  /** ISO date (yyyy-mm-dd) the batch expires. */
  expiry: string;
  qty: number;
  reorderLevel: number;
  /** Unit price in ZMW. */
  unitPrice: number;
  /** Store this stock sits in; legacy records live in the main store. */
  storeId?: string;
  /** Catalogue product this stock fulfils; legacy rows link by name only. */
  productId?: string;
};

export type RequestStatus = "pending" | "approved" | "dispatched" | "delivered" | "cancelled";
export type RequestPriority = "routine" | "urgent";

export type StockRequest = {
  id: string;
  item: string;
  qty: number;
  priority: RequestPriority;
  status: RequestStatus;
  submittedAt: number;
  /** Store the replenishment is headed to; legacy records hit the main store. */
  storeId?: string;
};

export type Delivery = {
  id: string;
  supplier: string;
  items: string;
  units: number;
  receivedAt: number;
  condition: "verified";
  /** Store the goods were received into; legacy records landed in main. */
  storeId?: string;
};

export type OutboundDeliveryStatus = "pending" | "in-transit" | "delivered" | "failed";

/** A sale leaving the pharmacy for a patient — rider, address and lifecycle. */
export type OutboundDelivery = {
  id: string;
  saleId?: string;
  patientName: string;
  address: string;
  riderName: string;
  status: OutboundDeliveryStatus;
  createdAt: number;
  updatedAt: number;
  storeId?: string;
};

export const PHARMACY_OUTBOUND_KEY = "pulse.pharmacy-outbound.v1";

/** A network supplier the pharmacy can raise purchase orders against. */
export type Supplier = {
  id: string;
  name: string;
  categories: string[];
  /** Typical fulfilment window, e.g. "1–2 days". */
  leadTime: string;
  /** Minimum order value in ZMW. */
  minOrder: number;
  /** Network rating out of 5. */
  rating: number;
  contact: string;
  verified: boolean;
};

/** Portal preferences persisted per device. */
export type PharmacySettings = {
  lowStockAlerts: boolean;
  /**
   * Units on hand at which the low-stock email fires. An item's own reorder
   * level raises this when it is set higher, so nothing alerts late.
   */
  lowStockThreshold: number;
  /** Where the low-stock email goes; empty means the signed-in user's email. */
  lowStockAlertEmail: string;
  deliveryUpdates: boolean;
  requestStatus: boolean;
  weeklyDigest: boolean;
};

/** A sellable product in the pharmacy's master catalogue. */
export type CatalogueProduct = {
  id: string;
  name: string;
  category: string;
  /** Sellable unit, e.g. "pack", "box", "bottle". */
  unit: string;
  /** Shelf price in ZMW. */
  price: number;
  /** True when the item may only be sold against a prescription. */
  prescription: boolean;
  /** One-line note shown on the shelf card. */
  note?: string;
  /**
   * Units on hand that mark this product low. Carried onto the shelf rows
   * booked from the catalogue so the bell and alert email use the same number.
   */
  lowStockTrigger?: number;
  createdAt: number;
};

export type POSPaymentMethod = "cash" | "mobile" | "card";

/** One line on a counter receipt. */
export type POSSaleLine = {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  /** Shelf batches deducted at checkout, so a reversal can restore the exact stock. */
  stockAllocations?: {
    inventoryItemId: string;
    qty: number;
    storeId: string;
    category: string;
    batch: string;
    expiry: string;
    reorderLevel: number;
  }[];
};

/** A completed sale at the Point of Sale counter. */
export type POSSale = {
  id: string;
  lines: POSSaleLine[];
  subtotal: number;
  /** Discount in ZMW. */
  discount: number;
  total: number;
  method: POSPaymentMethod;
  /** Cash tendered / change, when the method is cash. */
  tendered?: number;
  change?: number;
  soldAt: number;
  /** The counter's store; legacy sales sit in the main store. */
  storeId?: string;
  /** Store label copied onto the sale so network reports retain its context. */
  storeName?: string;
  servedBy: string;
  /** Patient the sale was dispensed to — required for prescription items. */
  patientName?: string;
  /** Prescription reference verified at the counter for prescription items. */
  prescriptionRef?: string;
  /** Reversals preserve the original receipt and record who, when and why. */
  reversedAt?: number;
  reversedBy?: string;
  reversalReason?: string;
  /** Confirms the actual tender refund or void was handled outside Pulse. */
  refundHandled?: boolean;
};

export type PurchaseOrderStatus = "draft" | "sent" | "received" | "cancelled";

/** How quickly the hub should handle an order. */
export type PurchaseOrderPriority = "routine" | "urgent";

/* ------------------------------------------------------------------ */
/* Stock movement — the single ledger every quantity change flows      */
/* through. The Inventory page is read-only; adjustments, receipts,    */
/* issues, transfers and returns are recorded here.                    */
/* ------------------------------------------------------------------ */

export const PHARMACY_MOVEMENTS_KEY = "pulse.pharmacy-movements.v1";

export type MovementType = "receipt" | "issue" | "transfer" | "adjustment" | "return";

export const MOVEMENT_TYPE_META: Record<
  MovementType,
  { label: string; hint: string; delta: "in" | "out" | "move" }
> = {
  receipt: { label: "Receipt", hint: "Goods arriving from a supplier or the central hub", delta: "in" },
  issue: { label: "Issue", hint: "Stock leaving for dispensing, damage or expiry", delta: "out" },
  transfer: { label: "Transfer", hint: "Stock moving between your stores", delta: "move" },
  adjustment: { label: "Adjustment", hint: "Corrections found during a stock count", delta: "in" },
  return: { label: "Return", hint: "Goods returned by a customer or to a supplier", delta: "in" },
};

/** Why a movement happened — keeps the ledger auditable. */
export const MOVEMENT_REASONS: Record<MovementType, string[]> = {
  receipt: ["Supplier delivery", "Central hub restock", "Inter-branch receipt", "Other"],
  issue: ["Dispensed to patient", "POS sale", "Damaged / broken", "Expired — write-off", "Other"],
  transfer: ["Store request fulfilment", "Rebalancing stock", "Other"],
  adjustment: ["Stock count correction", "Damaged — write-off", "Expired — write-off", "Theft / loss", "Other"],
  return: ["Customer return — restock", "POS sale reversal", "Supplier return", "Other"],
};

/**
 * One line in the stock movement ledger. `qty` is always the change to the
 * source shelf in whole sellable units (positive = more on the shelf).
 */
export type StockMovement = {
  id: string;
  at: number;
  type: MovementType;
  /** Inventory item the movement is against. */
  itemId: string;
  productName: string;
  batch: string;
  /** Signed change applied to the `fromStoreId` shelf (transfer out is negative there). */
  qty: number;
  /** Store the stock left (or is adjusted in). */
  fromStoreId?: string;
  /** Destination store for transfers. */
  toStoreId?: string;
  reason: string;
  note?: string;
  actor: { name: string; email: string };
};

/* ------------------------------------------------------------------ */
/* Storage helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Rows an older build persisted from its demo fixtures. They are dropped on
 * load so a device that once ran the seeded console doesn't keep replaying
 * invented stock, sales or suppliers.
 */
const SEED_IDS = {
  movements: new Set(["MOV-5014", "MOV-5015", "MOV-5016", "MOV-5017", "MOV-5018"]),
  stores: new Set(["st-main", "st-kabwata", "st-makeni"]),
  inventory: new Set(Array.from({ length: 16 }, (_, i) => `inv-${String(i + 1).padStart(3, "0")}`)),
  requests: new Set(["REQ-1039", "REQ-1040", "REQ-1041", "REQ-1042"]),
  deliveries: new Set(["DLV-2041", "DLV-2038", "DLV-2035"]),
  suppliers: new Set(["sup-001", "sup-002", "sup-003", "sup-004", "sup-005", "sup-006"]),
  catalogue: new Set(Array.from({ length: 16 }, (_, i) => `cat-${String(i + 1).padStart(3, "0")}`)),
  sales: new Set(["SALE-2041", "SALE-2042", "SALE-2043", "SALE-2044"]),
  purchaseOrders: new Set(["PO-3016", "PO-3017", "PO-3018"]),
} satisfies Record<string, ReadonlySet<string>>;

/**
 * Declares which pharmacy subsequent loads/saves belong to. Called once the
 * signed-in identity resolves; every pharmacy list is stored under a key
 * scoped to this id, so two accounts never share shelves on one browser.
 */
export function setPharmacyScope(pharmacyId: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    const clean = (pharmacyId ?? "").trim();
    if (clean) window.localStorage.setItem(PHARMACY_SCOPE_KEY, clean);
    else window.localStorage.removeItem(PHARMACY_SCOPE_KEY);
  } catch {
    /* best-effort */
  }
}

/** Reads only records that were actually saved — no demo fallback. */
function loadStoredList<T>(key: string, seedIds?: ReadonlySet<string>): T[] {
  if (typeof window === "undefined") return [];
  try {
    const scoped = scopedPharmacyKey(key);
    let raw = window.localStorage.getItem(scoped);
    if (!raw && scoped !== key) {
      // Upgrade path: claim the pre-scoping legacy list for this pharmacy once,
      // then remove it so the next account on this browser starts empty.
      const legacy = window.localStorage.getItem(key);
      if (legacy) {
        window.localStorage.setItem(scoped, legacy);
        window.localStorage.removeItem(key);
        raw = legacy;
      }
    }
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as T[]).filter(
      (entry) => !seedIds?.has(String((entry as { id?: unknown } | null)?.id ?? ""))
    );
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Settings — device preferences only                                  */
/* ------------------------------------------------------------------ */

export const DEFAULT_PHARMACY_SETTINGS: PharmacySettings = {
  lowStockAlerts: true,
  lowStockThreshold: 10,
  lowStockAlertEmail: "",
  deliveryUpdates: true,
  requestStatus: true,
  weeklyDigest: false,
};

export function loadPharmacySettings(): PharmacySettings {
  if (typeof window === "undefined") return DEFAULT_PHARMACY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(scopedPharmacyKey(PHARMACY_SETTINGS_KEY));
    if (!raw) return DEFAULT_PHARMACY_SETTINGS;
    return { ...DEFAULT_PHARMACY_SETTINGS, ...(JSON.parse(raw) as Partial<PharmacySettings>) };
  } catch {
    return DEFAULT_PHARMACY_SETTINGS;
  }
}

export function savePharmacySettings(settings: PharmacySettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scopedPharmacyKey(PHARMACY_SETTINGS_KEY), JSON.stringify(settings));
  } catch {
    /* best-effort */
  }
  notifyPharmacyChange("settings");
}

/**
 * Tells live console chrome (the low-stock bell) that a locally stored list has
 * changed, so it can re-read shelves without waiting for a navigation.
 */
export function notifyPharmacyChange(change: "inventory" | "settings" | "stores"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("pulse:pharmacy-change", { detail: { change } }));
}

/* ------------------------------------------------------------------ */
/* Stores — the account can run several, with one declared main        */
/* ------------------------------------------------------------------ */

export const DEFAULT_STORE_ID = "st-main";

/** A storefront under the pharmacy account. Exactly one is the main store. */
export type PharmacyStore = {
  id: string;
  name: string;
  /** Area / neighbourhood the store trades from. */
  location: string;
  address: string;
  phone: string;
  /** The main store is the application's home storefront. */
  isMain: boolean;
  createdAt: number;
  /**
   * Units on hand that trigger this store's low-stock alert. Unset means the
   * account-wide limit in Settings applies; branches can differ.
   */
  lowStockThreshold?: number;
};

/** Stores always carry a main — the first entry is promoted if none does. */
export function loadStores(): PharmacyStore[] {
  const stores = loadStoredList<PharmacyStore>(PHARMACY_STORES_KEY, SEED_IDS.stores);
  if (!stores.some((store) => store.isMain)) {
    return stores.map((store, index) => (index === 0 ? { ...store, isMain: true } : store));
  }
  return stores;
}

export function saveStores(stores: PharmacyStore[]): void {
  savePharmacyList(PHARMACY_STORES_KEY, stores);
  notifyPharmacyChange("stores");
}

/** The store a stock record belongs to (legacy records live in the main store). */
export function resolveStoreId(entry: { storeId?: string }): string {
  return entry.storeId ?? DEFAULT_STORE_ID;
}

/** The account's declared main store, falling back to the first store. */
export function mainStoreOf(stores: PharmacyStore[]): PharmacyStore | undefined {
  return stores.find((store) => store.isMain) ?? stores[0];
}

/** Next sequential store id ("st-1"). */
export function nextStoreId(stores: PharmacyStore[]): string {
  const max = stores.reduce((acc, store) => {
    const n = Number.parseInt(store.id.replace("st-", ""), 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 0);
  return `st-${max + 1}`;
}

/* ------------------------------------------------------------------ */
/* Shelves, requests and deliveries                                    */
/* ------------------------------------------------------------------ */

export function loadInventory(): InventoryItem[] {
  return loadStoredList<InventoryItem>(PHARMACY_INVENTORY_KEY, SEED_IDS.inventory);
}

export function saveInventory(items: InventoryItem[]): void {
  savePharmacyList(PHARMACY_INVENTORY_KEY, items);
  notifyPharmacyChange("inventory");
}

export function loadStockRequests(): StockRequest[] {
  return loadStoredList<StockRequest>(PHARMACY_REQUESTS_KEY, SEED_IDS.requests);
}

export function saveStockRequests(requests: StockRequest[]): void {
  savePharmacyList(PHARMACY_REQUESTS_KEY, requests);
}

export function loadDeliveries(): Delivery[] {
  return loadStoredList<Delivery>(PHARMACY_DELIVERIES_KEY, SEED_IDS.deliveries);
}

export function saveDeliveries(deliveries: Delivery[]): void {
  savePharmacyList(PHARMACY_DELIVERIES_KEY, deliveries);
}

export function loadOutboundDeliveries(): OutboundDelivery[] {
  return loadStoredList<OutboundDelivery>(PHARMACY_OUTBOUND_KEY);
}

export function saveOutboundDeliveries(deliveries: OutboundDelivery[]): void {
  savePharmacyList(PHARMACY_OUTBOUND_KEY, deliveries);
}

/**
 * Credits received goods onto the shelves and into the movement ledger, so a
 * received purchase order, hub delivery or manual receipt becomes sellable
 * stock. Returns the number of units credited.
 */
export function creditReceivedLines(
  lines: ReceivedLine[],
  storeId: string,
  actor: { name: string; email: string },
  reason: string
): number {
  const clean = lines.filter((line) => line.name.trim() && line.qty > 0);
  if (clean.length === 0) return 0;
  const now = Date.now();
  const inventory = loadInventory();
  const movements = loadMovements();
  const { items, credited } = creditReceivedStock(inventory, clean, storeId, now, (index) => {
    const max = inventory.reduce((acc, item) => {
      const n = Number.parseInt(item.id.replace("inv-", ""), 10);
      return Number.isFinite(n) ? Math.max(acc, n) : acc;
    }, 1000);
    return `inv-${max + 1 + index}`;
  });
  for (const entry of credited) {
    movements.push({
      id: nextMovementId(movements),
      at: now,
      type: "receipt",
      itemId: entry.itemId,
      productName: entry.name,
      batch: entry.batch,
      qty: entry.qty,
      fromStoreId: storeId,
      reason,
      actor,
    });
  }
  saveInventory(items);
  saveMovements(movements);
  return credited.reduce((acc, entry) => acc + entry.qty, 0);
}

/** Saved supplier partners — the sources a purchase order can name. */
export function loadSuppliers(): Supplier[] {
  return loadStoredList<Supplier>(PHARMACY_SUPPLIERS_KEY, SEED_IDS.suppliers);
}

export function saveSuppliers(suppliers: Supplier[]): void {
  savePharmacyList(PHARMACY_SUPPLIERS_KEY, suppliers);
}

/**
 * Supplier names a purchase order can be raised against: saved partners plus
 * every supplier already used on an order or delivery, with the Pulse hub
 * always available so the dropdown is never empty.
 */
export function supplierOptions(): string[] {
  const names = new Set<string>();
  for (const supplier of loadSuppliers()) {
    if (supplier.name.trim()) names.add(supplier.name.trim());
  }
  for (const order of loadPurchaseOrders()) {
    if (order.supplier.trim()) names.add(order.supplier.trim());
  }
  for (const delivery of loadDeliveries()) {
    if (delivery.supplier.trim()) names.add(delivery.supplier.trim());
  }
  names.add("Pulse Central Hub");
  return [...names].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ */
/* Catalogue — the master list of sellable products                    */
/* ------------------------------------------------------------------ */

export function loadCatalogue(): CatalogueProduct[] {
  return loadStoredList<CatalogueProduct>(PHARMACY_CATALOGUE_KEY, SEED_IDS.catalogue);
}

export function saveCatalogue(products: CatalogueProduct[]): void {
  savePharmacyList(PHARMACY_CATALOGUE_KEY, products);
}

/** Live shelf stock for a catalogue product — summed across its batches. */
export function stockForProduct(
  name: string,
  items: InventoryItem[],
  storeId?: string,
  productId?: string
): number {
  return items
    .filter((item) => {
      const linked = productId
        ? item.productId === productId || (!item.productId && item.name === name)
        : item.name === name;
      return linked && (!storeId || storeId === "all" || resolveStoreId(item) === storeId);
    })
    .reduce((acc, item) => acc + item.qty, 0);
}

/** Next sequential catalogue id ("cat-1001") — clear of legacy demo rows. */
export function nextCatalogueId(products: CatalogueProduct[]): string {
  const max = products.reduce((acc, product) => {
    const n = Number.parseInt(product.id.replace("cat-", ""), 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 1000);
  return `cat-${max + 1}`;
}

/* ------------------------------------------------------------------ */
/* Point of Sale — completed counter sales                             */
/* ------------------------------------------------------------------ */

export function loadSales(): POSSale[] {
  return loadStoredList<POSSale>(PHARMACY_SALES_KEY, SEED_IDS.sales);
}

export function saveSales(sales: POSSale[]): void {
  savePharmacyList(PHARMACY_SALES_KEY, sales);
}

/* ------------------------------------------------------------------ */
/* Purchase orders — goods ordered from suppliers                      */
/* ------------------------------------------------------------------ */

export function loadPurchaseOrders(): PurchaseOrder[] {
  return loadStoredList<PurchaseOrder>(PHARMACY_PURCHASE_ORDERS_KEY, SEED_IDS.purchaseOrders);
}

export function savePurchaseOrders(orders: PurchaseOrder[]): void {
  savePharmacyList(PHARMACY_PURCHASE_ORDERS_KEY, orders);
}

/** One line on a purchase order. */
export type PurchaseOrderLine = {
  id: string;
  name: string;
  qty: number;
  /** Unit cost in ZMW. */
  unitCost: number;
  /** Catalogue product ordered, when the line came from the catalogue. */
  productId?: string;
};

/** An order raised to a network supplier. */
export type PurchaseOrder = {
  id: string;
  supplier: string;
  status: PurchaseOrderStatus;
  /** Handling priority; legacy orders without one are treated as routine. */
  priority?: PurchaseOrderPriority;
  createdAt: number;
  /** ISO date (yyyy-mm-dd) the goods are expected. */
  expectedAt?: string;
  lines: PurchaseOrderLine[];
  notes?: string;
  /** Destination store; legacy orders land in the main store. */
  storeId?: string;
  sentAt?: number;
  receivedAt?: number;
};

/* ------------------------------------------------------------------ */
/* Stock movement ledger                                               */
/* ------------------------------------------------------------------ */

export function loadMovements(): StockMovement[] {
  return loadStoredList<StockMovement>(PHARMACY_MOVEMENTS_KEY, SEED_IDS.movements);
}

export function saveMovements(movements: StockMovement[]): void {
  savePharmacyList(PHARMACY_MOVEMENTS_KEY, movements);
}

/** Next sequential movement id ("MOV-5001"). */
export function nextMovementId(movements: StockMovement[]): string {
  const max = movements.reduce((acc, entry) => {
    const n = Number.parseInt(entry.id.replace("MOV-", ""), 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 5000);
  return `MOV-${max + 1}`;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** "ZMW 1,240" — the Kwacha format used across the console and its reports. */
export function formatZMW(amount: number): string {
  return `ZMW ${Math.round(amount).toLocaleString("en-US")}`;
}

/** Short human date ("Jun 19"). */
export function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Next sequential id ("REQ-1001"). */
export function nextId(list: { id: string }[], prefix: string): string {
  const max = list.reduce((acc, entry) => {
    const n = Number.parseInt(entry.id.split("-")[1] ?? "0", 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 1000);
  return `${prefix}-${max + 1}`;
}
