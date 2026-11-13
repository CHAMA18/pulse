import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canChargePrescription,
  creditReceivedStock,
  lowStockLimitFor,
  nextRequestStatus,
  storeLowStockLimit,
  parseDeliveryItems,
  scopedStorageKey,
  triggeredLowStock,
  type ShelfItem,
} from "../src/lib/pharmacy-stock.ts";

test("tenant scoping: different pharmacies never share a storage key", () => {
  assert.notEqual(scopedStorageKey("pulse.pharmacy-inventory.v1", "phm-a"), scopedStorageKey("pulse.pharmacy-inventory.v1", "phm-b"));
  assert.equal(scopedStorageKey("pulse.pharmacy-inventory.v1", ""), "pulse.pharmacy-inventory.v1");
  assert.equal(scopedStorageKey("pulse.pharmacy-inventory.v1", null), "pulse.pharmacy-inventory.v1");
});

test("delivery items parse into credited lines", () => {
  assert.deepEqual(parseDeliveryItems("Amoxicillin 500mg × 20 · Paracetamol 1g × 5", 25), [
    { name: "Amoxicillin 500mg", qty: 20 },
    { name: "Paracetamol 1g", qty: 5 },
  ]);
  assert.deepEqual(parseDeliveryItems("Mixed cartons", 12), [{ name: "Mixed cartons", qty: 12 }]);
  assert.deepEqual(parseDeliveryItems("", 0), []);
});

test("receiving stock credits shelves and tops up existing batches", () => {
  const shelves: ShelfItem[] = [
    { id: "inv-1", name: "Amoxicillin 500mg", category: "Antibiotics", batch: "B1", expiry: "2027-01-01", qty: 3, reorderLevel: 2, unitPrice: 10, storeId: "st-main" },
  ];
  const { items, credited } = creditReceivedStock(
    shelves,
    [
      { name: "Amoxicillin 500mg", qty: 20 },
      { name: "Paracetamol 1g", qty: 5, unitCost: 4 },
    ],
    "st-main",
    1_700_000_000_000,
    (i) => `inv-new-${i}`
  );
  assert.equal(items.find((i) => i.id === "inv-1")?.qty, 23);
  assert.equal(items.length, 2);
  assert.equal(credited.length, 2);
  // A different store must not be topped up from this receipt.
  const other = creditReceivedStock(shelves, [{ name: "Amoxicillin 500mg", qty: 7 }], "st-branch", 1_700_000_000_000, (i) => `inv-b-${i}`);
  assert.equal(other.items.find((i) => i.id === "inv-1")?.qty, 3);
});

test("stock request lifecycle only moves forward through the hub", () => {
  assert.equal(nextRequestStatus("pending", "approve"), "approved");
  assert.equal(nextRequestStatus("approved", "dispatch"), "dispatched");
  assert.equal(nextRequestStatus("dispatched", "deliver"), "delivered");
  assert.equal(nextRequestStatus("pending", "deliver"), null);
  assert.equal(nextRequestStatus("delivered", "cancel"), null);
  assert.equal(nextRequestStatus("pending", "cancel"), "cancelled");
});

test("low-stock trigger honours the configured limit and higher reorder levels", () => {
  const shelves: ShelfItem[] = [
    { id: "a", name: "Amoxicillin 500mg", category: "Antibiotics", batch: "B1", expiry: "2027-01-01", qty: 10, reorderLevel: 4, unitPrice: 10, storeId: "st-main" },
    { id: "b", name: "Paracetamol 1g", category: "Analgesics", batch: "B2", expiry: "2027-01-01", qty: 40, reorderLevel: 50, unitPrice: 4, storeId: "st-main" },
    { id: "c", name: "Vitamin C", category: "Supplements", batch: "B3", expiry: "2027-01-01", qty: 11, reorderLevel: 2, unitPrice: 6, storeId: "st-main" },
  ];
  // qty 10 triggers at the configured limit, 40 triggers on its own reorder level.
  assert.deepEqual(triggeredLowStock(shelves, 10).map((item) => item.id), ["a", "b"]);
  // Raising the limit pulls in anything at or below it.
  assert.deepEqual(triggeredLowStock(shelves, 11).map((item) => item.id), ["a", "c", "b"]);
  // No configured limit leaves the per-item reorder levels in charge.
  assert.deepEqual(triggeredLowStock(shelves, 0).map((item) => item.id), ["b"]);
  assert.equal(lowStockLimitFor({ reorderLevel: 50 }, 10), 50);
  assert.equal(lowStockLimitFor({ reorderLevel: 0 }, 10), 10);
});

test("per-store trigger limits override the account default", () => {
  const katondo: ShelfItem = { id: "a", name: "Amoxicillin 500mg", category: "Antibiotics", batch: "B1", expiry: "2027-01-01", qty: 4, reorderLevel: 0, unitPrice: 10, storeId: "st-main" };
  const kabwata: ShelfItem = { ...katondo, id: "b", qty: 18, storeId: "st-1" };
  const shelves = [katondo, kabwata];
  // Kabwata alerts at 25 units; the main store keeps the account default of 5.
  const limitFor = (item: ShelfItem) =>
    storeLowStockLimit({ lowStockThreshold: item.storeId === "st-1" ? 25 : undefined }, 5);
  assert.deepEqual(triggeredLowStock(shelves, limitFor).map((item) => item.id), ["a", "b"]);
  // Without the branch override, the 18-unit shelf stays above the default of 5.
  assert.deepEqual(triggeredLowStock(shelves, 5).map((item) => item.id), ["a"]);
  assert.equal(storeLowStockLimit({ lowStockThreshold: 0 }, 10), 0);
  assert.equal(storeLowStockLimit(undefined, 10), 10);
});

test("prescription sales require a named patient and verification", () => {
  assert.equal(canChargePrescription({ hasPrescriptionItems: false, patientName: "", prescriptionVerified: false }), true);
  assert.equal(canChargePrescription({ hasPrescriptionItems: true, patientName: "", prescriptionVerified: true }), false);
  assert.equal(canChargePrescription({ hasPrescriptionItems: true, patientName: "Mary Banda", prescriptionVerified: false }), false);
  assert.equal(canChargePrescription({ hasPrescriptionItems: true, patientName: "Mary Banda", prescriptionVerified: true }), true);
});
