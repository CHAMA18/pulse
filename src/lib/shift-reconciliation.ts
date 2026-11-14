/**
 * Pure shift cash reconciliation. Kept free of browser/Firebase imports so the
 * expected-till maths can be tested independently of the UI.
 */

export type ShiftTotals = {
  cashSales: number;
  cashRefunds: number;
  expectedCash: number;
  mobileSales: number;
  cardSales: number;
  totalSales: number;
  transactionCount: number;
  itemsSold: number;
};

export type ShiftReconciliationInput = {
  id: string;
  cashierEmail: string;
  storeId: string;
  openedAt: number;
  closedAt?: number;
  openingFloat: number;
};

export type ShiftSale = {
  id: string;
  method: string;
  total: number;
  soldAt: number;
  reversedAt?: number;
  shiftId?: string;
  cashierEmail?: string;
  storeId?: string;
  lines: readonly { qty: number }[];
};

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function computeShiftTotals(
  shift: ShiftReconciliationInput,
  sales: readonly ShiftSale[]
): ShiftTotals {
  const end = shift.closedAt ?? Date.now();
  const email = normalizeEmail(shift.cashierEmail);
  const inWindow = (sale: ShiftSale) =>
    sale.soldAt >= shift.openedAt && sale.soldAt <= end;

  const linked = sales.filter((sale) => {
    if (sale.shiftId) return sale.shiftId === shift.id && inWindow(sale);
    // Legacy sales written before shifts existed can still reconcile when
    // they were served by this cashier at this store inside the window.
    return (
      !sale.shiftId &&
      normalizeEmail(sale.cashierEmail ?? "") === email &&
      (sale.storeId ?? "st-main") === shift.storeId &&
      inWindow(sale)
    );
  });

  const completed = linked.filter((sale) => !sale.reversedAt);
  const linkedIds = new Set(linked.map((sale) => sale.id));

  const cashSales = completed
    .filter((sale) => sale.method === "cash")
    .reduce((sum, sale) => sum + sale.total, 0);
  const mobileSales = completed
    .filter((sale) => sale.method === "mobile")
    .reduce((sum, sale) => sum + sale.total, 0);
  const cardSales = completed
    .filter((sale) => sale.method === "card")
    .reduce((sum, sale) => sum + sale.total, 0);

  // A refund of a sale from an earlier shift leaves this till but was not
  // part of this shift's cash sales. Same-shift reversals are already
  // excluded from cashSales, so they are not subtracted twice.
  const cashRefunds = sales
    .filter(
      (sale) =>
        sale.method === "cash" &&
        sale.reversedAt !== undefined &&
        sale.reversedAt >= shift.openedAt &&
        sale.reversedAt <= end &&
        !linkedIds.has(sale.id)
    )
    .reduce((sum, sale) => sum + sale.total, 0);

  return {
    cashSales: roundMoney(cashSales),
    cashRefunds: roundMoney(cashRefunds),
    expectedCash: roundMoney(shift.openingFloat + cashSales - cashRefunds),
    mobileSales: roundMoney(mobileSales),
    cardSales: roundMoney(cardSales),
    totalSales: roundMoney(completed.reduce((sum, sale) => sum + sale.total, 0)),
    transactionCount: completed.length,
    itemsSold: completed.reduce(
      (sum, sale) => sum + sale.lines.reduce((lineSum, line) => lineSum + line.qty, 0),
      0
    ),
  };
}
