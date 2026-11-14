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
import {
  findCatalogueProductByName,
  storeHasProduct,
} from "../src/lib/pharmacy-catalogue.ts";
import { computeShiftTotals } from "../src/lib/shift-reconciliation.ts";
import {
  DUNIYA_MARKUP_PERCENT,
  duniyaUnitPrice,
  impliedCostPrice,
  priceLayers,
} from "../src/lib/pricing.ts";
import {
  auditSchedule,
  computeReconciliation,
  RECONCILIATION_CADENCE_MS,
} from "../src/lib/stock-reconciliation.ts";

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
  assert.equal(nextRequestStatus("pending", "reject"), "rejected");
  assert.equal(nextRequestStatus("approved", "reject"), "rejected");
});

test("pricing layers keep cost, Duniya and retail distinct", () => {
  assert.equal(DUNIYA_MARKUP_PERCENT, 20);
  assert.equal(duniyaUnitPrice(10), 12);
  assert.equal(duniyaUnitPrice(12.5, 20), 15);
  assert.equal(impliedCostPrice(12), 10);
  const layers = priceLayers({ costPrice: 10, retailPrice: 18 });
  assert.equal(layers.duniyaPrice, 12);
  assert.equal(layers.markupAmount, 2);
  assert.equal(layers.marginAmount, 6);
  assert.equal(layers.marginPercent, 33.33);
  // A pharmacy may sell below its own cost; the margin is clamped at zero so
  // the report never claims a negative cash margin.
  assert.equal(priceLayers({ costPrice: 10, retailPrice: 8 }).marginAmount, 0);
});

test("physical reconciliation values shortages and overages at all three prices", () => {
  const result = computeReconciliation([
    {
      name: "Amoxicillin 500mg",
      expectedQty: 20,
      countedQty: 17,
      costPrice: 10,
      markupPercent: 20,
      retailPrice: 18,
    },
    {
      name: "Paracetamol 1g",
      expectedQty: 10,
      countedQty: 12,
      costPrice: 4,
      markupPercent: 20,
      retailPrice: 8,
    },
    {
      name: "Vitamin C",
      expectedQty: 5,
      countedQty: 5,
      costPrice: 6,
      markupPercent: 20,
      retailPrice: 9,
    },
  ]);
  assert.equal(result.totals.expectedUnits, 35);
  assert.equal(result.totals.countedUnits, 34);
  assert.equal(result.totals.varianceUnits, -1);
  assert.equal(result.totals.shortageUnits, 3);
  assert.equal(result.totals.overageUnits, 2);
  assert.equal(result.totals.shortLines, 1);
  assert.equal(result.totals.overLines, 1);
  assert.equal(result.totals.balancedLines, 1);
  assert.equal(result.lines[0]?.varianceQty, -3);
  assert.equal(result.lines[0]?.varianceDuniyaValue, -36);
  assert.equal(result.lines[0]?.varianceRetailValue, -54);
  assert.equal(result.lines[1]?.varianceCostValue, 8);
  assert.equal(result.lines[1]?.varianceDuniyaValue, 9.6);
  assert.equal(result.totals.expectedDuniyaValue, 324);
  assert.equal(result.totals.expectedRetailValue, 485);
});

test("two-week audit cadence starts on the last completed count", () => {
  const now = 1_700_000_000_000;
  const never = auditSchedule(null, now);
  assert.equal(never.status, "never");
  const fresh = auditSchedule(now - 2 * 24 * 60 * 60 * 1000, now);
  assert.equal(fresh.status, "scheduled");
  assert.equal(fresh.daysUntilDue, 12);
  const dueSoon = auditSchedule(now - 11 * 24 * 60 * 60 * 1000, now);
  assert.equal(dueSoon.status, "due");
  const overdue = auditSchedule(now - RECONCILIATION_CADENCE_MS - 1, now);
  assert.equal(overdue.status, "overdue");
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

test("catalogue duplicate checks are scoped to the store that stocks the product", () => {
  const shelves = [
    { name: "Amoxicillin 500mg", storeId: "st-main" },
    { name: "Paracetamol 1g", storeId: "st-1" },
  ];
  assert.equal(storeHasProduct("st-main", " amoxicillin 500MG ", shelves), true);
  assert.equal(storeHasProduct("st-1", "Amoxicillin 500mg", shelves), false);
  assert.equal(storeHasProduct("st-1", "Paracetamol 1g", shelves), true);
  // Legacy shelves without a storeId belong to the main store.
  assert.equal(storeHasProduct("st-main", "Paracetamol 1g", [{ name: "Paracetamol 1g" }]), true);
});

test("catalogue lookup reuses one product record across stores", () => {
  const catalogue = [{ id: "cat-1", name: "Amoxicillin 500mg" }];
  assert.equal(findCatalogueProductByName(catalogue, " amoxicillin 500MG ")?.id, "cat-1");
  assert.equal(findCatalogueProductByName(catalogue, "Paracetamol 1g"), undefined);
});

test("shift close expects float plus cash sales, with mobile and card kept separate", () => {
  const base = {
    id: "SHIFT-1001",
    cashierEmail: "cashier@pharmacy.zm",
    storeId: "st-main",
    openedAt: 1_000,
    closedAt: 2_000,
    openingFloat: 500,
  };
  const sale = (
    id: string,
    method: "cash" | "mobile" | "card",
    total: number,
    soldAt: number,
    shiftId = "SHIFT-1001"
  ) => ({
    id,
    method,
    total,
    soldAt,
    shiftId,
    lines: [{ qty: 1 }],
  });
  const totals = computeShiftTotals(base, [
    sale("SALE-1", "cash", 100, 1_100),
    sale("SALE-2", "mobile", 50, 1_200),
    sale("SALE-3", "card", 25, 1_300),
    sale("SALE-OTHER", "cash", 999, 900, "SHIFT-OTHER"),
  ]);
  assert.equal(totals.cashSales, 100);
  assert.equal(totals.mobileSales, 50);
  assert.equal(totals.cardSales, 25);
  assert.equal(totals.totalSales, 175);
  assert.equal(totals.expectedCash, 600);
  assert.equal(totals.transactionCount, 3);
});

test("shift close refunds earlier-shift cash once and ignores same-shift reversal twice", () => {
  const base = {
    id: "SHIFT-1002",
    cashierEmail: "cashier@pharmacy.zm",
    storeId: "st-main",
    openedAt: 1_000,
    closedAt: 2_000,
    openingFloat: 500,
  };
  const totals = computeShiftTotals(base, [
    // Cash from the previous shift, refunded from this drawer: leaves the till.
    {
      id: "SALE-OLD",
      method: "cash" as const,
      total: 80,
      soldAt: 500,
      shiftId: "SHIFT-1001",
      reversedAt: 1_500,
      lines: [{ qty: 1 }],
    },
    // A sale from this shift reversed within it is already excluded below.
    {
      id: "SALE-NEW",
      method: "cash" as const,
      total: 30,
      soldAt: 1_100,
      shiftId: "SHIFT-1002",
      reversedAt: 1_600,
      lines: [{ qty: 1 }],
    },
  ]);
  assert.equal(totals.cashSales, 0);
  assert.equal(totals.cashRefunds, 80);
  assert.equal(totals.expectedCash, 420);
});

test("legacy cashier sales inside the window still reconcile without a shift id", () => {
  const totals = computeShiftTotals(
    {
      id: "SHIFT-1003",
      cashierEmail: "cashier@pharmacy.zm",
      storeId: "st-main",
      openedAt: 1_000,
      closedAt: 2_000,
      openingFloat: 0,
    },
    [
      {
        id: "SALE-LEGACY",
        method: "cash",
        total: 40,
        soldAt: 1_100,
        cashierEmail: "CASHIER@pharmacy.zm",
        lines: [{ qty: 1 }],
      },
      {
        id: "SALE-OTHER-STORE",
        method: "cash",
        total: 90,
        soldAt: 1_200,
        cashierEmail: "cashier@pharmacy.zm",
        storeId: "st-branch",
        lines: [{ qty: 1 }],
      },
    ]
  );
  assert.equal(totals.cashSales, 40);
  assert.equal(totals.expectedCash, 40);
});
