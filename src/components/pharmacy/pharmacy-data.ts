"use client";

import { loadPharmacyList, savePharmacyList } from "@/components/pharmacy/pharmacy-shared";

/* ------------------------------------------------------------------ */
/* Pharmacy portal data model                                          */
/* ------------------------------------------------------------------ */
/* The operational stores behind the Pharmacy portal console. Seeds    */
/* mirror a live Zambian community pharmacy; edits persist to          */
/* localStorage so the console keeps its state across reloads.         */

export const PHARMACY_INVENTORY_KEY = "pulse.pharmacy-inventory.v1";
export const PHARMACY_REQUESTS_KEY = "pulse.pharmacy-requests.v1";
export const PHARMACY_DELIVERIES_KEY = "pulse.pharmacy-deliveries.v1";

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
};

export type Delivery = {
  id: string;
  supplier: string;
  items: string;
  units: number;
  receivedAt: number;
  condition: "verified";
};

const DAY = 24 * 60 * 60 * 1000;

/** The shelves every fresh pharmacy console opens with. */
const SEED_INVENTORY: InventoryItem[] = [
  { id: "inv-001", name: "Coartem 20/60 (pack)", category: "Antimalarial", batch: "CTM-2601-14", expiry: "2027-01-31", qty: 46, reorderLevel: 20, unitPrice: 85 },
  { id: "inv-002", name: "Paracetamol 500mg (pack)", category: "Analgesic", batch: "PCM-2512-07", expiry: "2026-12-31", qty: 120, reorderLevel: 40, unitPrice: 15 },
  { id: "inv-003", name: "Amoxicillin 250mg (caps)", category: "Antibiotic", batch: "AMX-2603-22", expiry: "2027-03-31", qty: 18, reorderLevel: 25, unitPrice: 38 },
  { id: "inv-004", name: "Ibuprofen 400mg (pack)", category: "Analgesic", batch: "IBU-2602-09", expiry: "2027-02-28", qty: 64, reorderLevel: 30, unitPrice: 22 },
  { id: "inv-005", name: "Metronidazole 400mg (pack)", category: "Antibiotic", batch: "MTZ-2604-11", expiry: "2027-04-30", qty: 34, reorderLevel: 20, unitPrice: 26 },
  { id: "inv-006", name: "ORS Sachet (20 ml)", category: "Rehydration", batch: "ORS-2605-03", expiry: "2027-05-31", qty: 150, reorderLevel: 60, unitPrice: 5 },
  { id: "inv-007", name: "Zinc Sulphate 20mg (pack)", category: "Supplement", batch: "ZNS-2606-17", expiry: "2027-06-30", qty: 0, reorderLevel: 24, unitPrice: 12 },
  { id: "inv-008", name: "Ferrous Sulphate (pack)", category: "Supplement", batch: "FES-2511-28", expiry: "2026-11-30", qty: 40, reorderLevel: 18, unitPrice: 18 },
  { id: "inv-009", name: "Loratadine 10mg (pack)", category: "Antihistamine", batch: "LRT-2607-05", expiry: "2027-07-31", qty: 52, reorderLevel: 20, unitPrice: 20 },
  { id: "inv-010", name: "Surgical Face Masks (box)", category: "Consumable", batch: "MSK-2608-12", expiry: "2028-01-31", qty: 26, reorderLevel: 12, unitPrice: 90 },
  { id: "inv-011", name: "Examination Gloves (box)", category: "Consumable", batch: "GLV-2609-19", expiry: "2028-02-29", qty: 9, reorderLevel: 12, unitPrice: 120 },
  { id: "inv-012", name: "Vitamin C 500mg (pack)", category: "Supplement", batch: "VTC-2610-23", expiry: "2027-10-31", qty: 75, reorderLevel: 30, unitPrice: 25 },
];

/** The request queue every fresh console opens with. */
const SEED_REQUESTS: StockRequest[] = [
  { id: "REQ-1039", item: "Examination Gloves (box)", qty: 12, priority: "routine", status: "pending", submittedAt: Date.now() - 5 * 60 * 60 * 1000 },
  { id: "REQ-1040", item: "ORS Sachet (20 ml)", qty: 100, priority: "urgent", status: "dispatched", submittedAt: Date.now() - 1 * DAY },
  { id: "REQ-1041", item: "Amoxicillin 250mg (caps)", qty: 60, priority: "routine", status: "delivered", submittedAt: Date.now() - 6 * DAY },
  { id: "REQ-1042", item: "Coartem 20/60 (pack)", qty: 40, priority: "routine", status: "approved", submittedAt: Date.now() - 2 * DAY },
];

/** Goods received every fresh console opens with. */
const SEED_DELIVERIES: Delivery[] = [
  { id: "DLV-2041", supplier: "Pulse Central Hub", items: "Amoxicillin 250mg × 60", units: 60, receivedAt: Date.now() - 6 * DAY, condition: "verified" },
  { id: "DLV-2038", supplier: "MedTech Wholesalers", items: "Face masks × 20 · Gloves × 10", units: 30, receivedAt: Date.now() - 12 * DAY, condition: "verified" },
  { id: "DLV-2035", supplier: "Pulse Central Hub", items: "Paracetamol 500mg × 100", units: 100, receivedAt: Date.now() - 20 * DAY, condition: "verified" },
];

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
