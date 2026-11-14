"use client";

import {
  loadSales,
  type POSSale,
} from "@/components/pharmacy/pharmacy-data";
import { scopedPharmacyKey } from "@/components/pharmacy/pharmacy-shared";
import { computeShiftTotals } from "@/lib/shift-reconciliation";

export type { ShiftTotals } from "@/lib/shift-reconciliation";

/* ------------------------------------------------------------------ */
/* Shift management                                                    */
/* ------------------------------------------------------------------ */
/* A shift is the cashier's accountability window at one till. The     */
/* system total is the opening float plus cash taken less cash         */
/* refunded; closing records the cash actually counted and the         */
/* variance, then hands the till to the next person.                   */

export const PHARMACY_SHIFTS_KEY = "pulse.pharmacy-shifts.v1";
export const SHIFTS_EVENT = "pulse:shifts-change";

export type ShiftStatus = "open" | "closed";

export type PharmacyShift = {
  id: string;
  cashierName: string;
  cashierEmail: string;
  storeId: string;
  storeName: string;
  status: ShiftStatus;
  openedAt: number;
  openingFloat: number;
  closedAt?: number;
  countedCash?: number;
  expectedCash?: number;
  variance?: number;
  cashSales?: number;
  cashRefunds?: number;
  mobileSales?: number;
  cardSales?: number;
  totalSales?: number;
  transactionCount?: number;
  itemsSold?: number;
  closingNotes?: string;
  closedBy?: string;
  /** Person receiving the till when the shift is handed over. */
  handoverTo?: string;
};

export type ShiftActor = {
  name: string;
  email: string;
};

/** Cash figures need cents — unlike the dashboard's rounded ZMW display. */
export function formatShiftZMW(amount: number): string {
  return `ZMW ${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function notifyShiftChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SHIFTS_EVENT));
}

function isShift(value: unknown): value is PharmacyShift {
  if (!value || typeof value !== "object") return false;
  const shift = value as Partial<PharmacyShift>;
  return (
    typeof shift.id === "string" &&
    typeof shift.cashierName === "string" &&
    typeof shift.cashierEmail === "string" &&
    typeof shift.storeId === "string" &&
    typeof shift.storeName === "string" &&
    (shift.status === "open" || shift.status === "closed") &&
    typeof shift.openedAt === "number" &&
    Number.isFinite(shift.openedAt) &&
    typeof shift.openingFloat === "number" &&
    Number.isFinite(shift.openingFloat)
  );
}

export function loadShifts(): PharmacyShift[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scopedPharmacyKey(PHARMACY_SHIFTS_KEY));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isShift)
      .sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

export function saveShifts(shifts: PharmacyShift[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      scopedPharmacyKey(PHARMACY_SHIFTS_KEY),
      JSON.stringify(shifts.slice(0, 5000))
    );
  } catch {
    /* storage full or unavailable — the in-memory console still works */
  }
  notifyShiftChange();
}

export function nextShiftId(shifts: PharmacyShift[]): string {
  const max = shifts.reduce((acc, shift) => {
    const n = Number.parseInt(shift.id.replace("SHIFT-", ""), 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 1000);
  return `SHIFT-${max + 1}`;
}

/** The signed-in cashier's open shift, if one exists. */
export function activeShiftForEmail(
  email: string,
  shifts: PharmacyShift[] = loadShifts()
): PharmacyShift | undefined {
  const target = normalizeEmail(email);
  if (!target) return undefined;
  return shifts
    .filter(
      (shift) =>
        shift.status === "open" && normalizeEmail(shift.cashierEmail) === target
    )
    .sort((a, b) => b.openedAt - a.openedAt)[0];
}

/** The signed-in cashier's open shift for the till being used. */
export function activeShiftForStore(
  email: string,
  storeId: string,
  shifts: PharmacyShift[] = loadShifts()
): PharmacyShift | undefined {
  const shift = activeShiftForEmail(email, shifts);
  return shift?.storeId === storeId ? shift : undefined;
}

/** Cash currently expected in the till: float + cash in − cash refunded. */
export function shiftTotals(shift: PharmacyShift, sales: POSSale[]) {
  return computeShiftTotals(shift, sales);
}

export function openShift(input: {
  actor: ShiftActor;
  storeId: string;
  storeName: string;
  openingFloat: number;
}): PharmacyShift {
  const email = normalizeEmail(input.actor.email);
  if (!email) throw new Error("Sign in to open a shift.");
  if (!input.storeId.trim()) throw new Error("Choose a store before opening a shift.");

  const shifts = loadShifts();
  const existing = activeShiftForStore(email, input.storeId, shifts);
  if (existing) {
    throw new Error(`${existing.id} is already open at ${existing.storeName}.`);
  }
  const elsewhere = activeShiftForEmail(email, shifts);
  if (elsewhere) {
    throw new Error(
      `Close your open shift at ${elsewhere.storeName} before opening another.`
    );
  }
  const storeOpen = shifts.find(
    (entry) => entry.status === "open" && entry.storeId === input.storeId
  );
  if (storeOpen) {
    throw new Error(
      `${storeOpen.id} is open for ${storeOpen.cashierName} at ${storeOpen.storeName}. Close that shift before opening a new one.`
    );
  }

  const shift: PharmacyShift = {
    id: nextShiftId(shifts),
    cashierName: input.actor.name || email.split("@")[0] || "Cashier",
    cashierEmail: email,
    storeId: input.storeId,
    storeName: input.storeName || "Store",
    status: "open",
    openedAt: Date.now(),
    openingFloat: roundMoney(Math.max(0, input.openingFloat)),
  };
  saveShifts([shift, ...shifts]);
  return shift;
}

export function closeShift(input: {
  shiftId: string;
  countedCash: number;
  closingNotes?: string;
  handoverTo?: string;
  actor: ShiftActor;
}): PharmacyShift {
  const shifts = loadShifts();
  const shift = shifts.find((entry) => entry.id === input.shiftId);
  if (!shift) throw new Error("That shift could not be found.");
  if (normalizeEmail(shift.cashierEmail) !== normalizeEmail(input.actor.email)) {
    throw new Error("Only the cashier who opened this shift can close it.");
  }
  if (shift.status !== "open") throw new Error("That shift is already closed.");
  if (!Number.isFinite(input.countedCash) || input.countedCash < 0) {
    throw new Error("Enter the cash counted in the till.");
  }

  const closedAt = Date.now();
  const draft: PharmacyShift = { ...shift, closedAt };
  const totals = shiftTotals(draft, loadSales());
  const countedCash = roundMoney(input.countedCash);
  const variance = roundMoney(countedCash - totals.expectedCash);

  const closed: PharmacyShift = {
    ...draft,
    status: "closed",
    countedCash,
    expectedCash: totals.expectedCash,
    variance,
    cashSales: totals.cashSales,
    cashRefunds: totals.cashRefunds,
    mobileSales: totals.mobileSales,
    cardSales: totals.cardSales,
    totalSales: totals.totalSales,
    transactionCount: totals.transactionCount,
    itemsSold: totals.itemsSold,
    closedBy: input.actor.name || shift.cashierName,
    ...(input.closingNotes?.trim()
      ? { closingNotes: input.closingNotes.trim().slice(0, 1000) }
      : {}),
    ...(input.handoverTo?.trim()
      ? { handoverTo: input.handoverTo.trim().slice(0, 120) }
      : {}),
  };

  saveShifts(shifts.map((entry) => (entry.id === closed.id ? closed : entry)));
  return closed;
}

/** "8h 24m" — shift duration shown in history and on the open-shift card. */
export function shiftDuration(shift: PharmacyShift): string {
  const end = shift.closedAt ?? Date.now();
  const minutes = Math.max(0, Math.round((end - shift.openedAt) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return `${hours}h ${rest}m`;
}

export function varianceLabel(variance: number | undefined): string {
  if (variance === undefined || Math.abs(variance) < 0.005) return "Balanced";
  return variance > 0 ? "Over" : "Short";
}
