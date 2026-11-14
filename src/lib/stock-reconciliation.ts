/* ------------------------------------------------------------------ */
/* Two-week physical stock reconciliation — pure maths                 */
/* ------------------------------------------------------------------ */
/* Pulse audits a pharmacy's shelves every two weeks. The network knows */
/* what should be there; an auditor records what is physically there.   */
/* These helpers turn those two numbers into variance, value at cost,   */
/* value at the Duniya price and value at retail — the figures the      */
/* pharmacy and Duniya settle against.                                  */

import {
  DUNIYA_MARKUP_PERCENT,
  duniyaUnitPrice,
  impliedCostPrice,
  normaliseMarkup,
  roundMoney,
  roundQty,
} from "./pricing.ts";

export const RECONCILIATION_CADENCE_DAYS = 14;
export const RECONCILIATION_CADENCE_MS =
  RECONCILIATION_CADENCE_DAYS * 24 * 60 * 60 * 1000;

export type ReconciliationLineInput = {
  itemId?: string;
  productId?: string;
  name: string;
  category?: string;
  batch?: string;
  expiry?: string;
  storeId?: string;
  storeName?: string;
  expectedQty: number;
  countedQty: number;
  /** Supplier cost for one unit; legacy rows may omit it. */
  costPrice?: number;
  markupPercent?: number;
  /** Pharmacy shelf price for one unit. */
  retailPrice?: number;
};

export type ReconciliationLine = ReconciliationLineInput & {
  expectedQty: number;
  countedQty: number;
  varianceQty: number;
  costPrice: number;
  markupPercent: number;
  duniyaPrice: number;
  retailPrice: number;
  expectedCostValue: number;
  expectedDuniyaValue: number;
  expectedRetailValue: number;
  varianceCostValue: number;
  varianceDuniyaValue: number;
  varianceRetailValue: number;
};

export type ReconciliationTotals = {
  lineCount: number;
  expectedUnits: number;
  countedUnits: number;
  varianceUnits: number;
  shortageUnits: number;
  overageUnits: number;
  balancedLines: number;
  shortLines: number;
  overLines: number;
  expectedCostValue: number;
  expectedDuniyaValue: number;
  expectedRetailValue: number;
  varianceCostValue: number;
  varianceDuniyaValue: number;
  varianceRetailValue: number;
};

export type ReconciliationResult = {
  lines: ReconciliationLine[];
  totals: ReconciliationTotals;
};

function cleanLine(line: ReconciliationLineInput): ReconciliationLine {
  const expectedQty = roundQty(line.expectedQty);
  const countedQty = roundQty(line.countedQty);
  const markupPercent = normaliseMarkup(line.markupPercent);
  const retailPrice = Math.max(0, roundMoney(line.retailPrice ?? 0));
  // A legacy shelf may only have its retail price. Recover a sensible cost
  // from the standard markup rather than treating retail as cost.
  const costPrice = Math.max(
    0,
    roundMoney(
      line.costPrice !== undefined && Number.isFinite(line.costPrice)
        ? line.costPrice
        : impliedCostPrice(retailPrice, markupPercent)
    )
  );
  const duniyaPrice = duniyaUnitPrice(costPrice, markupPercent);
  const varianceQty = countedQty - expectedQty;

  return {
    ...line,
    name: line.name.trim().slice(0, 200),
    category: line.category?.trim().slice(0, 120),
    batch: line.batch?.trim().slice(0, 120),
    expiry: line.expiry?.trim().slice(0, 30),
    storeId: line.storeId?.trim().slice(0, 120),
    storeName: line.storeName?.trim().slice(0, 160),
    expectedQty,
    countedQty,
    varianceQty,
    costPrice,
    markupPercent,
    duniyaPrice,
    retailPrice,
    expectedCostValue: roundMoney(expectedQty * costPrice),
    expectedDuniyaValue: roundMoney(expectedQty * duniyaPrice),
    expectedRetailValue: roundMoney(expectedQty * retailPrice),
    varianceCostValue: roundMoney(varianceQty * costPrice),
    varianceDuniyaValue: roundMoney(varianceQty * duniyaPrice),
    varianceRetailValue: roundMoney(varianceQty * retailPrice),
  };
}

/** Computes every audit line and the settlement totals in one pass. */
export function computeReconciliation(
  lines: ReconciliationLineInput[],
  fallbackMarkup = DUNIYA_MARKUP_PERCENT
): ReconciliationResult {
  const clean = lines
    .filter((line) => line && typeof line.name === "string" && line.name.trim().length > 0)
    .slice(0, 500)
    .map((line) =>
      cleanLine({
        ...line,
        markupPercent: line.markupPercent ?? fallbackMarkup,
      })
    );

  const totals = clean.reduce<ReconciliationTotals>(
    (acc, line) => {
      acc.lineCount += 1;
      acc.expectedUnits += line.expectedQty;
      acc.countedUnits += line.countedQty;
      acc.varianceUnits += line.varianceQty;
      if (line.varianceQty < 0) {
        acc.shortageUnits += Math.abs(line.varianceQty);
        acc.shortLines += 1;
      } else if (line.varianceQty > 0) {
        acc.overageUnits += line.varianceQty;
        acc.overLines += 1;
      } else {
        acc.balancedLines += 1;
      }
      acc.expectedCostValue = roundMoney(acc.expectedCostValue + line.expectedCostValue);
      acc.expectedDuniyaValue = roundMoney(acc.expectedDuniyaValue + line.expectedDuniyaValue);
      acc.expectedRetailValue = roundMoney(acc.expectedRetailValue + line.expectedRetailValue);
      acc.varianceCostValue = roundMoney(acc.varianceCostValue + line.varianceCostValue);
      acc.varianceDuniyaValue = roundMoney(acc.varianceDuniyaValue + line.varianceDuniyaValue);
      acc.varianceRetailValue = roundMoney(acc.varianceRetailValue + line.varianceRetailValue);
      return acc;
    },
    {
      lineCount: 0,
      expectedUnits: 0,
      countedUnits: 0,
      varianceUnits: 0,
      shortageUnits: 0,
      overageUnits: 0,
      balancedLines: 0,
      shortLines: 0,
      overLines: 0,
      expectedCostValue: 0,
      expectedDuniyaValue: 0,
      expectedRetailValue: 0,
      varianceCostValue: 0,
      varianceDuniyaValue: 0,
      varianceRetailValue: 0,
    }
  );

  return { lines: clean, totals };
}

export type AuditSchedule = {
  lastCompletedAt: number | null;
  nextDueAt: number | null;
  daysUntilDue: number | null;
  status: "never" | "due" | "overdue" | "scheduled";
};

/** The two-week cadence starts at the most recent completed audit. */
export function auditSchedule(
  lastCompletedAt: number | null | undefined,
  now = Date.now(),
  cadenceMs = RECONCILIATION_CADENCE_MS
): AuditSchedule {
  if (!lastCompletedAt || !Number.isFinite(lastCompletedAt)) {
    return { lastCompletedAt: null, nextDueAt: null, daysUntilDue: null, status: "never" };
  }
  const nextDueAt = lastCompletedAt + cadenceMs;
  const daysUntilDue = Math.ceil((nextDueAt - now) / (24 * 60 * 60 * 1000));
  return {
    lastCompletedAt,
    nextDueAt,
    daysUntilDue,
    status: nextDueAt <= now ? "overdue" : daysUntilDue <= 3 ? "due" : "scheduled",
  };
}
