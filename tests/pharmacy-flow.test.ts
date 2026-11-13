import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canChargePrescription,
  creditReceivedStock,
  nextRequestStatus,
  parseDeliveryItems,
  scopedStorageKey,
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

test("prescription sales require a named patient and verification", () => {
  assert.equal(canChargePrescription({ hasPrescriptionItems: false, patientName: "", prescriptionVerified: false }), true);
  assert.equal(canChargePrescription({ hasPrescriptionItems: true, patientName: "", prescriptionVerified: true }), false);
  assert.equal(canChargePrescription({ hasPrescriptionItems: true, patientName: "Mary Banda", prescriptionVerified: false }), false);
  assert.equal(canChargePrescription({ hasPrescriptionItems: true, patientName: "Mary Banda", prescriptionVerified: true }), true);
});
