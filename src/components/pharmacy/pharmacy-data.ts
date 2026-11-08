"use client";

import { loadPharmacyList, savePharmacyList } from "@/components/pharmacy/pharmacy-shared";

/* ------------------------------------------------------------------ */
/* Pharmacy portal data model                                          */
/* ------------------------------------------------------------------ */
/* The operational stores behind the Pharmacy portal console. Seeds    */
/* mirror a live Zambian community pharmacy; edits persist to          */
/* localStorage so the console keeps its state across reloads.         */
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

/** A network supplier shown in the Pharmacy portal's Supplier Directory. */
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
  createdAt: number;
};

export type POSPaymentMethod = "cash" | "mobile" | "card";

/** One line on a counter receipt. */
export type POSSaleLine = {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
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
  servedBy: string;
};

export type PurchaseOrderStatus = "draft" | "sent" | "received" | "cancelled";

/** One line on a purchase order. */
export type PurchaseOrderLine = {
  id: string;
  name: string;
  qty: number;
  /** Unit cost in ZMW. */
  unitCost: number;
};

/** An order raised to a network supplier. */
export type PurchaseOrder = {
  id: string;
  supplier: string;
  status: PurchaseOrderStatus;
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

export const DEFAULT_PHARMACY_SETTINGS: PharmacySettings = {
  lowStockAlerts: true,
  deliveryUpdates: true,
  requestStatus: true,
  weeklyDigest: false,
};

export function loadPharmacySettings(): PharmacySettings {
  if (typeof window === "undefined") return DEFAULT_PHARMACY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(PHARMACY_SETTINGS_KEY);
    if (!raw) return DEFAULT_PHARMACY_SETTINGS;
    return { ...DEFAULT_PHARMACY_SETTINGS, ...(JSON.parse(raw) as Partial<PharmacySettings>) };
  } catch {
    return DEFAULT_PHARMACY_SETTINGS;
  }
}

export function savePharmacySettings(settings: PharmacySettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PHARMACY_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* best-effort */
  }
}

const DAY = 24 * 60 * 60 * 1000;

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
};

/** The stores every fresh account opens with — one main, two branches. */
const SEED_STORES: PharmacyStore[] = [
  {
    id: "st-main",
    name: "Cairo Road Main Store",
    location: "Lusaka CBD",
    address: "Plot 12, Cairo Road, Lusaka 10101",
    phone: "+260 97 000 2000",
    isMain: true,
    createdAt: Date.now() - 400 * DAY,
  },
  {
    id: "st-kabwata",
    name: "Kabwata Branch",
    location: "Kabwata, Lusaka",
    address: "Shop 4, Kabwata Market Arcade, Lusaka 10109",
    phone: "+260 96 411 0820",
    isMain: false,
    createdAt: Date.now() - 190 * DAY,
  },
  {
    id: "st-makeni",
    name: "Makeni Clinic Point",
    location: "Makeni, Lusaka",
    address: "Vineyard Clinic, Kafue Road, Makeni 10102",
    phone: "+260 95 220 7731",
    isMain: false,
    createdAt: Date.now() - 30 * DAY,
  },
];

/** Stores always carry a main — the first entry is promoted if none does. */
export function loadStores(): PharmacyStore[] {
  const stores = loadPharmacyList(PHARMACY_STORES_KEY, SEED_STORES);
  if (!stores.some((store) => store.isMain)) {
    return stores.map((store, index) => (index === 0 ? { ...store, isMain: true } : store));
  }
  return stores;
}

export function saveStores(stores: PharmacyStore[]): void {
  savePharmacyList(PHARMACY_STORES_KEY, stores);
}

/** The store a stock record belongs to (legacy records live in the main store). */
export function resolveStoreId(entry: { storeId?: string }): string {
  return entry.storeId ?? DEFAULT_STORE_ID;
}

/** The account's declared main store, falling back to the first store. */
export function mainStoreOf(stores: PharmacyStore[]): PharmacyStore | undefined {
  return stores.find((store) => store.isMain) ?? stores[0];
}

/** Next sequential store id ("st-4"). */
export function nextStoreId(stores: PharmacyStore[]): string {
  const max = stores.reduce((acc, store) => {
    const n = Number.parseInt(store.id.replace("st-", ""), 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 0);
  return `st-${max + 1}`;
}

/** The shelves every fresh pharmacy console opens with. */
const SEED_INVENTORY: InventoryItem[] = [
  { id: "inv-001", name: "Coartem 20/60 (pack)", category: "Antimalarial", batch: "CTM-2601-14", expiry: "2027-01-31", qty: 46, reorderLevel: 20, unitPrice: 85 },
  { id: "inv-002", name: "Paracetamol 500mg (pack)", category: "Analgesic", batch: "PCM-2512-07", expiry: "2026-12-31", qty: 120, reorderLevel: 40, unitPrice: 15, storeId: "st-kabwata" },
  { id: "inv-003", name: "Amoxicillin 250mg (caps)", category: "Antibiotic", batch: "AMX-2603-22", expiry: "2027-03-31", qty: 18, reorderLevel: 25, unitPrice: 38 },
  { id: "inv-004", name: "Ibuprofen 400mg (pack)", category: "Analgesic", batch: "IBU-2602-09", expiry: "2027-02-28", qty: 64, reorderLevel: 30, unitPrice: 22 },
  { id: "inv-005", name: "Metronidazole 400mg (pack)", category: "Antibiotic", batch: "MTZ-2604-11", expiry: "2027-04-30", qty: 34, reorderLevel: 20, unitPrice: 26 },
  { id: "inv-006", name: "ORS Sachet (20 ml)", category: "Rehydration", batch: "ORS-2605-03", expiry: "2027-05-31", qty: 150, reorderLevel: 60, unitPrice: 5, storeId: "st-makeni" },
  { id: "inv-007", name: "Zinc Sulphate 20mg (pack)", category: "Supplement", batch: "ZNS-2606-17", expiry: "2027-06-30", qty: 0, reorderLevel: 24, unitPrice: 12 },
  { id: "inv-008", name: "Ferrous Sulphate (pack)", category: "Supplement", batch: "FES-2511-28", expiry: "2026-11-30", qty: 40, reorderLevel: 18, unitPrice: 18 },
  { id: "inv-009", name: "Loratadine 10mg (pack)", category: "Antihistamine", batch: "LRT-2607-05", expiry: "2027-07-31", qty: 52, reorderLevel: 20, unitPrice: 20 },
  { id: "inv-010", name: "Surgical Face Masks (box)", category: "Consumable", batch: "MSK-2608-12", expiry: "2028-01-31", qty: 26, reorderLevel: 12, unitPrice: 90 },
  { id: "inv-011", name: "Examination Gloves (box)", category: "Consumable", batch: "GLV-2609-19", expiry: "2028-02-29", qty: 9, reorderLevel: 12, unitPrice: 120 },
  { id: "inv-012", name: "Vitamin C 500mg (pack)", category: "Supplement", batch: "VTC-2610-23", expiry: "2027-10-31", qty: 75, reorderLevel: 30, unitPrice: 25, storeId: "st-kabwata" },
  { id: "inv-013", name: "Cough Syrup 100ml (bottle)", category: "Cold & Flu", batch: "CSY-2602-18", expiry: "2027-02-28", qty: 28, reorderLevel: 10, unitPrice: 32, storeId: "st-kabwata" },
  { id: "inv-014", name: "Hand Sanitizer 250ml (bottle)", category: "Consumable", batch: "HSN-2607-22", expiry: "2027-07-31", qty: 42, reorderLevel: 15, unitPrice: 25 },
  { id: "inv-015", name: "Vitamin D3 1000IU (pack)", category: "Supplement", batch: "VD3-2611-08", expiry: "2027-11-30", qty: 33, reorderLevel: 12, unitPrice: 45, storeId: "st-makeni" },
  { id: "inv-016", name: "Sterile Gauze Roll (pack)", category: "First Aid", batch: "GAU-2701-30", expiry: "2028-01-31", qty: 55, reorderLevel: 20, unitPrice: 12 },
];

/** The request queue every fresh console opens with. */
const SEED_REQUESTS: StockRequest[] = [
  { id: "REQ-1039", item: "Examination Gloves (box)", qty: 12, priority: "routine", status: "pending", submittedAt: Date.now() - 5 * 60 * 60 * 1000 },
  { id: "REQ-1040", item: "ORS Sachet (20 ml)", qty: 100, priority: "urgent", status: "dispatched", submittedAt: Date.now() - 1 * DAY, storeId: "st-kabwata" },
  { id: "REQ-1041", item: "Amoxicillin 250mg (caps)", qty: 60, priority: "routine", status: "delivered", submittedAt: Date.now() - 6 * DAY },
  { id: "REQ-1042", item: "Coartem 20/60 (pack)", qty: 40, priority: "routine", status: "approved", submittedAt: Date.now() - 2 * DAY, storeId: "st-makeni" },
];

/** Goods received every fresh console opens with. */
const SEED_DELIVERIES: Delivery[] = [
  { id: "DLV-2041", supplier: "Pulse Central Hub", items: "Amoxicillin 250mg × 60", units: 60, receivedAt: Date.now() - 6 * DAY, condition: "verified" },
  { id: "DLV-2038", supplier: "MedTech Wholesalers", items: "Face masks × 20 · Gloves × 10", units: 30, receivedAt: Date.now() - 12 * DAY, condition: "verified", storeId: "st-kabwata" },
  { id: "DLV-2035", supplier: "Pulse Central Hub", items: "Paracetamol 500mg × 100", units: 100, receivedAt: Date.now() - 20 * DAY, condition: "verified" },
];

/** The supplier network every fresh console opens with. */
const SEED_SUPPLIERS: Supplier[] = [
  {
    id: "sup-001",
    name: "Pulse Central Hub",
    categories: ["Pharmaceuticals", "Supplements"],
    leadTime: "1–2 days",
    minOrder: 500,
    rating: 4.9,
    contact: "hub@pulse.network · +260 97 000 1000",
    verified: true,
  },
  {
    id: "sup-002",
    name: "MedTech Wholesalers",
    categories: ["Consumables", "Equipment"],
    leadTime: "2–4 days",
    minOrder: 800,
    rating: 4.6,
    contact: "orders@medtech.zm · +260 96 555 2100",
    verified: true,
  },
  {
    id: "sup-003",
    name: "Zambia Pharma Distributors",
    categories: ["Pharmaceuticals"],
    leadTime: "3–5 days",
    minOrder: 1200,
    rating: 4.4,
    contact: "sales@zpharma.zm · +260 95 414 7788",
    verified: true,
  },
  {
    id: "sup-004",
    name: "CarePlus Medical Supplies",
    categories: ["Consumables", "Pharmaceuticals"],
    leadTime: "2–3 days",
    minOrder: 650,
    rating: 4.7,
    contact: "hello@careplus.zm · +260 97 233 9090",
    verified: true,
  },
  {
    id: "sup-005",
    name: "VitaWell Supplements Ltd",
    categories: ["Supplements"],
    leadTime: "4–6 days",
    minOrder: 400,
    rating: 4.2,
    contact: "trade@vitawell.zm · +260 96 880 4411",
    verified: false,
  },
  {
    id: "sup-006",
    name: "Lusaka Cold-Chain Logistics",
    categories: ["Equipment", "Consumables"],
    leadTime: "1–3 days",
    minOrder: 950,
    rating: 4.5,
    contact: "dispatch@lcc.zm · +260 95 700 6262",
    verified: true,
  },
];

export function loadSuppliers(): Supplier[] {
  return loadPharmacyList("pulse.pharmacy-suppliers.v1", SEED_SUPPLIERS);
}

export function loadInventory(): InventoryItem[] {
  return loadPharmacyList(PHARMACY_INVENTORY_KEY, SEED_INVENTORY);
}

export function saveInventory(items: InventoryItem[]): void {
  savePharmacyList(PHARMACY_INVENTORY_KEY, items);
}

export function loadStockRequests(): StockRequest[] {
  return loadPharmacyList(PHARMACY_REQUESTS_KEY, SEED_REQUESTS);
}

export function saveStockRequests(requests: StockRequest[]): void {
  savePharmacyList(PHARMACY_REQUESTS_KEY, requests);
}

export function loadDeliveries(): Delivery[] {
  return loadPharmacyList(PHARMACY_DELIVERIES_KEY, SEED_DELIVERIES);
}

export function saveDeliveries(deliveries: Delivery[]): void {
  savePharmacyList(PHARMACY_DELIVERIES_KEY, deliveries);
}

/* ------------------------------------------------------------------ */
/* Catalogue — the master list of sellable products                    */
/* ------------------------------------------------------------------ */

const RX_CATEGORIES = new Set(["Antibiotic", "Antimalarial"]);

/** Derives a catalogue unit ("pack", "box"…) from a product name's "(pack)" suffix. */
function unitOf(name: string): string {
  const match = name.match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : "unit";
}

const CATALOGUE_NOTES: Record<string, string> = {
  "Coartem 20/60 (pack)": "Artemether/lumefantrine — first-line malaria treatment",
  "Paracetamol 500mg (pack)": "Pain and fever relief, 16 tablets per pack",
  "Amoxicillin 250mg (caps)": "Broad-spectrum antibiotic, 21 capsules",
  "Ibuprofen 400mg (pack)": "Anti-inflammatory, 10 tablets",
  "Metronidazole 400mg (pack)": "Antibacterial and antiprotozoal, 21 tablets",
  "ORS Sachet (20 ml)": "Oral rehydration salts — mix with 1 L clean water",
  "Zinc Sulphate 20mg (pack)": "Immune support and diarrhoea recovery",
  "Ferrous Sulphate (pack)": "Iron supplementation for anaemia",
  "Loratadine 10mg (pack)": "Non-drowsy allergy relief, 10 tablets",
  "Surgical Face Masks (box)": "3-ply, 50 masks per box",
  "Examination Gloves (box)": "Latex-free nitrile, 100 gloves per box",
  "Vitamin C 500mg (pack)": "Daily immune support, 30 tablets",
  "Cough Syrup 100ml (bottle)": "Soothing syrup for dry & chesty coughs",
  "Hand Sanitizer 250ml (bottle)": "70% alcohol gel with aloe",
  "Vitamin D3 1000IU (pack)": "Bone & immune support, 30 capsules",
  "Sterile Gauze Roll (pack)": "Absorbent 10 cm roll for wound care",
};

/** The catalogue mirrors the shelves — one card per stocked product. */
function buildSeedCatalogue(): CatalogueProduct[] {
  return SEED_INVENTORY.map((item, index) => ({
    id: `cat-${String(index + 1).padStart(3, "0")}`,
    name: item.name,
    category: item.category,
    unit: unitOf(item.name),
    price: item.unitPrice,
    prescription: RX_CATEGORIES.has(item.category),
    note: CATALOGUE_NOTES[item.name],
    createdAt: Date.now() - (200 - index * 11) * DAY,
  }));
}

export function loadCatalogue(): CatalogueProduct[] {
  if (typeof window === "undefined") return buildSeedCatalogue();
  try {
    const raw = window.localStorage.getItem(PHARMACY_CATALOGUE_KEY);
    if (!raw) return buildSeedCatalogue();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as CatalogueProduct[]) : buildSeedCatalogue();
  } catch {
    return buildSeedCatalogue();
  }
}

export function saveCatalogue(products: CatalogueProduct[]): void {
  savePharmacyList(PHARMACY_CATALOGUE_KEY, products);
}

/** Live shelf stock for a catalogue product — summed across its batches. */
export function stockForProduct(
  name: string,
  items: InventoryItem[],
  storeId?: string
): number {
  return items
    .filter((item) => item.name === name && (!storeId || storeId === "all" || resolveStoreId(item) === storeId))
    .reduce((acc, item) => acc + item.qty, 0);
}

/** Next sequential catalogue id ("cat-017"). */
export function nextCatalogueId(products: CatalogueProduct[]): string {
  const max = products.reduce((acc, product) => {
    const n = Number.parseInt(product.id.replace("cat-", ""), 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 0);
  return `cat-${String(max + 1).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Point of Sale — completed counter sales                             */
/* ------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;

const SEED_SALES: POSSale[] = [
  {
    id: "SALE-2041",
    lines: [
      { productId: "cat-002", name: "Paracetamol 500mg (pack)", qty: 2, unitPrice: 15 },
      { productId: "cat-009", name: "Loratadine 10mg (pack)", qty: 1, unitPrice: 20 },
    ],
    subtotal: 50,
    discount: 0,
    total: 50,
    method: "cash",
    tendered: 50,
    change: 0,
    soldAt: Date.now() - 9 * HOUR,
    servedBy: "Front counter",
  },
  {
    id: "SALE-2042",
    lines: [
      { productId: "cat-006", name: "ORS Sachet (20 ml)", qty: 3, unitPrice: 5 },
      { productId: "cat-014", name: "Hand Sanitizer 250ml (bottle)", qty: 1, unitPrice: 25 },
    ],
    subtotal: 40,
    discount: 0,
    total: 40,
    method: "mobile",
    soldAt: Date.now() - 6 * HOUR,
    servedBy: "Front counter",
  },
  {
    id: "SALE-2043",
    lines: [
      { productId: "cat-004", name: "Ibuprofen 400mg (pack)", qty: 1, unitPrice: 22 },
      { productId: "cat-016", name: "Sterile Gauze Roll (pack)", qty: 2, unitPrice: 12 },
      { productId: "cat-012", name: "Vitamin C 500mg (pack)", qty: 1, unitPrice: 25 },
    ],
    subtotal: 71,
    discount: 5,
    total: 66,
    method: "cash",
    tendered: 100,
    change: 34,
    soldAt: Date.now() - 2 * HOUR,
    servedBy: "Front counter",
  },
  {
    id: "SALE-2044",
    lines: [
      { productId: "cat-002", name: "Paracetamol 500mg (pack)", qty: 1, unitPrice: 15 },
      { productId: "cat-010", name: "Surgical Face Masks (box)", qty: 1, unitPrice: 90 },
    ],
    subtotal: 105,
    discount: 0,
    total: 105,
    method: "card",
    soldAt: Date.now() - 40 * 60 * 1000,
    servedBy: "Front counter",
  },
];

export function loadSales(): POSSale[] {
  return loadPharmacyList(PHARMACY_SALES_KEY, SEED_SALES);
}

export function saveSales(sales: POSSale[]): void {
  savePharmacyList(PHARMACY_SALES_KEY, sales);
}

/* ------------------------------------------------------------------ */
/* Purchase orders — goods ordered from network suppliers              */
/* ------------------------------------------------------------------ */

const SEED_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: "PO-3018",
    supplier: "Pulse Central Hub",
    status: "sent",
    createdAt: Date.now() - 2 * DAY,
    expectedAt: new Date(Date.now() + 1 * DAY).toISOString().slice(0, 10),
    lines: [
      { id: "pol-1", name: "Amoxicillin 250mg (caps)", qty: 40, unitCost: 26 },
      { id: "pol-2", name: "Examination Gloves (box)", qty: 15, unitCost: 92 },
    ],
    notes: "Replenish antibiotic shelf before the month-end rush.",
  },
  {
    id: "PO-3017",
    supplier: "CarePlus Medical Supplies",
    status: "received",
    createdAt: Date.now() - 9 * DAY,
    expectedAt: new Date(Date.now() - 4 * DAY).toISOString().slice(0, 10),
    lines: [
      { id: "pol-1", name: "Surgical Face Masks (box)", qty: 12, unitCost: 70 },
      { id: "pol-2", name: "Sterile Gauze Roll (pack)", qty: 30, unitCost: 8 },
    ],
    sentAt: Date.now() - 9 * DAY,
    receivedAt: Date.now() - 4 * DAY,
  },
  {
    id: "PO-3016",
    supplier: "VitaWell Supplements Ltd",
    status: "draft",
    createdAt: Date.now() - 26 * HOUR,
    expectedAt: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10),
    lines: [{ id: "pol-1", name: "Vitamin D3 1000IU (pack)", qty: 20, unitCost: 31 }],
    notes: "Awaiting confirmation of the wholesaler discount.",
  },
];

export function loadPurchaseOrders(): PurchaseOrder[] {
  return loadPharmacyList(PHARMACY_PURCHASE_ORDERS_KEY, SEED_PURCHASE_ORDERS);
}

export function savePurchaseOrders(orders: PurchaseOrder[]): void {
  savePharmacyList(PHARMACY_PURCHASE_ORDERS_KEY, orders);
}

/** "K 1,240" — the Kwacha format used across the pharmacy console. */
export function formatZMW(amount: number): string {
  return `K ${Math.round(amount).toLocaleString("en-US")}`;
}

/** Short human date ("Jun 19"). */
export function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Next sequential id ("REQ-1043"). */
export function nextId(list: { id: string }[], prefix: string): string {
  const max = list.reduce((acc, entry) => {
    const n = Number.parseInt(entry.id.split("-")[1] ?? "0", 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 1000);
  return `${prefix}-${max + 1}`;
}
