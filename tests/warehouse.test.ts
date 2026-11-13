import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWarehouseMovement,
  movementDelta,
  nextWarehouseMovementId,
  type WarehouseItem,
} from "../src/lib/warehouse.ts";

const shelves: WarehouseItem[] = [
  { id: "wh-1", name: "Amoxicillin 500mg", category: "Antibiotics", batch: "WH-1", expiry: "2027-06-01", qty: 100, reorderLevel: 25, unitPrice: 10 },
];
const actor = { name: "Chungu Chama", email: "owner@pulse.test" };

test("movement deltas follow the ledger direction rules", () => {
  assert.equal(movementDelta("receipt", 40), 40);
  assert.equal(movementDelta("return", 5), 5);
  assert.equal(movementDelta("issue", 30), -30);
  assert.equal(movementDelta("transfer", 10), -10);
  assert.equal(movementDelta("adjustment", -7), -7);
  assert.equal(movementDelta("adjustment", 3), 3);
});

test("catalogue and movements stay in sync: one apply moves shelf and ledger together", () => {
  const applied = applyWarehouseMovement(shelves, [], {
    type: "issue", itemId: "wh-1", qty: 30, reason: "Issued to pharmacy",
    actor, at: 1_700_000_000_000, id: "WHM-5001",
  });
  assert.ok(applied);
  assert.equal(applied.items[0].qty, 70);
  assert.equal(applied.movement.qty, -30);
  assert.equal(applied.movement.productName, "Amoxicillin 500mg");

  const received = applyWarehouseMovement(applied.items, [applied.movement], {
    type: "receipt", itemId: "wh-1", qty: 50, reason: "Supplier delivery",
    actor, at: 1_700_000_100_000, id: "WHM-5002",
  });
  assert.ok(received);
  assert.equal(received.items[0].qty, 120);
});

test("an issue records the pharmacy the stock is going to", () => {
  const applied = applyWarehouseMovement(shelves, [], {
    type: "issue", itemId: "wh-1", qty: 10, reason: "Issued to pharmacy",
    destinationPharmacyId: "phm-1", destinationPharmacyName: "City Pharmacy",
    actor, at: 1_700_000_000_000, id: "WHM-5001",
  });
  assert.ok(applied);
  assert.equal(applied.movement.destinationPharmacyName, "City Pharmacy");
  assert.equal(applied.movement.destinationPharmacyId, "phm-1");
});

test("a movement that would empty the shelf below zero is rejected whole", () => {
  const applied = applyWarehouseMovement(shelves, [], {
    type: "issue", itemId: "wh-1", qty: 101, reason: "Issued to pharmacy",
    actor, at: 1_700_000_000_000, id: "WHM-5001",
  });
  assert.equal(applied, null);
  assert.equal(shelves[0].qty, 100);
});

test("movement ids are sequential", () => {
  assert.equal(nextWarehouseMovementId([]), "WHM-5001");
  assert.equal(
    nextWarehouseMovementId([{ id: "WHM-5007", at: 0, type: "receipt", itemId: "wh-1", productName: "X", batch: "B", qty: 1, reason: "R", actor }]),
    "WHM-5008"
  );
});
