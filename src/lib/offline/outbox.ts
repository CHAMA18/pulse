"use client";

import {
  resolveStoreId,
  type InventoryItem,
  type PharmacyStore,
  type POSSale,
  type StockRequest,
} from "@/components/pharmacy/pharmacy-data";
import { scopedPharmacyKey } from "@/components/pharmacy/pharmacy-shared";
import type { PharmacyShift } from "@/lib/pharmacy-shifts";

/* ------------------------------------------------------------------ */
/* Offline sync outbox                                                */
/* ------------------------------------------------------------------ */
/* Pharmacy records are written to localStorage first, then mirrored   */
/* to Firebase. Network mirrors go through this outbox so a dropped    */
/* connection never loses a sale, shelf snapshot or low-stock alert —  */
/* the payload is persisted and flushed again on reconnect.            */
/*                                                                     */
/* Entries are snapshots, not operation logs: the inventory entry is   */
/* replaced by the latest shelves, sales are merged by sale id, and    */
/* alerts are replaced by the latest trigger set. The Firebase         */
/* callables are idempotent, so retries are safe.                      */

const OUTBOX_KEY = "pulse.sync-outbox.v1";

/** Fired whenever the queue changes, so chrome can update its badge. */
export const OUTBOX_EVENT = "pulse:outbox-change";

type OutboxEntryBase = {
  id: string;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
};

export type InventoryOutboxEntry = OutboxEntryBase & {
  kind: "inventory";
  items: (InventoryItem & { storeName?: string })[];
};

export type SalesOutboxEntry = OutboxEntryBase & {
  kind: "sales";
  sales: (POSSale & { storeName?: string })[];
};

export type ShiftOutboxEntry = OutboxEntryBase & {
  kind: "shifts";
  shifts: PharmacyShift[];
};

export type LowStockAlertOutboxEntry = OutboxEntryBase & {
  kind: "low-stock-alert";
  items: InventoryItem[];
  stores: PharmacyStore[];
  pharmacyName: string;
};

export type StockRequestsOutboxEntry = OutboxEntryBase & {
  kind: "stock-requests";
  requests: StockRequest[];
};

export type OutboxEntry =
  | InventoryOutboxEntry
  | SalesOutboxEntry
  | ShiftOutboxEntry
  | LowStockAlertOutboxEntry
  | StockRequestsOutboxEntry;

export type OutboxSummary = {
  /** Individual changes waiting — snapshots count once, sales by receipt. */
  total: number;
  inventory: number;
  sales: number;
  shifts: number;
  alerts: number;
  requests: number;
};

function newEntryId(): string {
  return `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function storageKey(): string {
  return scopedPharmacyKey(OUTBOX_KEY);
}

function notifyOutboxChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
}

function loadOutbox(): OutboxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OutboxEntry => {
      if (!entry || typeof entry !== "object") return false;
      const kind = (entry as { kind?: unknown }).kind;
      if (kind === "inventory") return Array.isArray((entry as InventoryOutboxEntry).items);
      if (kind === "sales") return Array.isArray((entry as SalesOutboxEntry).sales);
      if (kind === "shifts") return Array.isArray((entry as ShiftOutboxEntry).shifts);
      if (kind === "low-stock-alert") {
        return Array.isArray((entry as LowStockAlertOutboxEntry).items);
      }
      if (kind === "stock-requests") {
        return Array.isArray((entry as StockRequestsOutboxEntry).requests);
      }
      return false;
    });
  } catch {
    return [];
  }
}

function saveOutbox(entries: OutboxEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(entries));
  } catch {
    /* storage full or unavailable — the local records still hold the truth */
  }
  notifyOutboxChange();
}

/** Store-name lookup used by every snapshot payload. */
function storeNames(stores: PharmacyStore[]): Map<string, string> {
  return new Map(stores.map((store) => [store.id, store.name]));
}

/**
 * Queue (or refresh) the pharmacy's shelf snapshot. The latest snapshot wins:
 * older pending shelf payloads are dropped rather than replayed.
 */
export function queueInventorySync(
  items: InventoryItem[],
  stores: PharmacyStore[]
): void {
  const nameOf = storeNames(stores);
  const entry: InventoryOutboxEntry = {
    id: newEntryId(),
    kind: "inventory",
    createdAt: Date.now(),
    attempts: 0,
    items: items.map((item) => ({
      ...item,
      storeName: nameOf.get(resolveStoreId(item)) ?? "",
    })),
  };
  saveOutbox([...loadOutbox().filter((current) => current.kind !== "inventory"), entry]);
}

/** Queue sales for the network feed, merging with anything still pending. */
export function queueSalesSync(sales: POSSale[], stores: PharmacyStore[]): void {
  if (sales.length === 0) return;
  const nameOf = storeNames(stores);
  const entries = loadOutbox();
  const pending = entries.find(
    (entry): entry is SalesOutboxEntry => entry.kind === "sales"
  );
  const merged = new Map<string, POSSale & { storeName?: string }>();
  for (const sale of pending?.sales ?? []) merged.set(sale.id, sale);
  for (const sale of sales) {
    merged.set(sale.id, {
      ...sale,
      storeName: nameOf.get(resolveStoreId(sale)) ?? sale.storeName ?? "",
    });
  }
  const entry: SalesOutboxEntry = {
    id: pending?.id ?? newEntryId(),
    kind: "sales",
    createdAt: pending?.createdAt ?? Date.now(),
    attempts: pending?.attempts ?? 0,
    ...(pending?.lastAttemptAt ? { lastAttemptAt: pending.lastAttemptAt } : {}),
    ...(pending?.lastError ? { lastError: pending.lastError } : {}),
    sales: [...merged.values()],
  };
  saveOutbox([...entries.filter((current) => current.kind !== "sales"), entry]);
}

/** Queue shift opens/closes for the network trail, merging by shift id. */
export function queueShiftSync(shifts: PharmacyShift[]): void {
  if (shifts.length === 0) return;
  const entries = loadOutbox();
  const pending = entries.find(
    (entry): entry is ShiftOutboxEntry => entry.kind === "shifts"
  );
  const merged = new Map<string, PharmacyShift>();
  for (const shift of pending?.shifts ?? []) merged.set(shift.id, shift);
  for (const shift of shifts) merged.set(shift.id, shift);
  const entry: ShiftOutboxEntry = {
    id: pending?.id ?? newEntryId(),
    kind: "shifts",
    createdAt: pending?.createdAt ?? Date.now(),
    attempts: pending?.attempts ?? 0,
    ...(pending?.lastAttemptAt ? { lastAttemptAt: pending.lastAttemptAt } : {}),
    ...(pending?.lastError ? { lastError: pending.lastError } : {}),
    shifts: [...merged.values()],
  };
  saveOutbox([...entries.filter((current) => current.kind !== "shifts"), entry]);
}

/** Queue the consolidated low-stock alert; the server still throttles repeats. */
export function queueLowStockAlert(
  items: InventoryItem[],
  stores: PharmacyStore[],
  pharmacyName = ""
): void {
  const entry: LowStockAlertOutboxEntry = {
    id: newEntryId(),
    kind: "low-stock-alert",
    createdAt: Date.now(),
    attempts: 0,
    items: items.map((item) => ({ ...item })),
    stores: stores.map((store) => ({ ...store })),
    pharmacyName,
  };
  saveOutbox([
    ...loadOutbox().filter((current) => current.kind !== "low-stock-alert"),
    entry,
  ]);
}

/** Queue stock requests that could not reach the Pulse desk yet. */
export function queueStockRequests(requests: StockRequest[]): void {
  if (requests.length === 0) return;
  const entries = loadOutbox();
  const pending = entries.find(
    (entry): entry is StockRequestsOutboxEntry => entry.kind === "stock-requests"
  );
  const merged = new Map<string, StockRequest>();
  for (const request of pending?.requests ?? []) {
    merged.set(request.syncId ?? request.id, request);
  }
  for (const request of requests) merged.set(request.syncId ?? request.id, request);
  const entry: StockRequestsOutboxEntry = {
    id: pending?.id ?? newEntryId(),
    kind: "stock-requests",
    createdAt: pending?.createdAt ?? Date.now(),
    attempts: pending?.attempts ?? 0,
    ...(pending?.lastAttemptAt ? { lastAttemptAt: pending.lastAttemptAt } : {}),
    ...(pending?.lastError ? { lastError: pending.lastError } : {}),
    requests: [...merged.values()],
  };
  saveOutbox([...entries.filter((current) => current.kind !== "stock-requests"), entry]);
}

/** Drop a withdrawn request before the queue sends it to Pulse. */
export function discardQueuedStockRequests(keys: string[]): void {
  if (keys.length === 0) return;
  const discard = new Set(keys);
  const next: OutboxEntry[] = [];
  for (const entry of loadOutbox()) {
    if (entry.kind !== "stock-requests") {
      next.push(entry);
      continue;
    }
    const requests = entry.requests.filter(
      (request) => !discard.has(request.syncId ?? request.id)
    );
    if (requests.length > 0) next.push({ ...entry, requests });
  }
  saveOutbox(next);
}

/** Counts for the offline banner; snapshots count as one change each. */
export function getOutboxSummary(): OutboxSummary {
  const entries = loadOutbox();
  const inventory = entries.filter((entry) => entry.kind === "inventory").length;
  const alerts = entries.filter((entry) => entry.kind === "low-stock-alert").length;
  const sales = entries.reduce(
    (acc, entry) => acc + (entry.kind === "sales" ? entry.sales.length : 0),
    0
  );
  const shifts = entries.reduce(
    (acc, entry) => acc + (entry.kind === "shifts" ? entry.shifts.length : 0),
    0
  );
  const requests = entries.reduce(
    (acc, entry) => acc + (entry.kind === "stock-requests" ? entry.requests.length : 0),
    0
  );
  return {
    total: inventory + sales + shifts + alerts + requests,
    inventory,
    sales,
    shifts,
    alerts,
    requests,
  };
}

let flushing: Promise<boolean> | null = null;

/**
 * Flush the queue to Firebase. Safe to call repeatedly: concurrent calls share
 * one run, failures stay queued with their attempt count, and the promise
 * resolves true only when everything synced.
 */
export function flushOutbox(): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.onLine) {
    return Promise.resolve(false);
  }
  if (flushing) return flushing;

  const run = runFlush().finally(() => {
    flushing = null;
  });
  flushing = run;
  return run;
}

async function runFlush(): Promise<boolean> {
  if (loadOutbox().length === 0) return true;

  // Never drop queued work just because Firebase is not configured.
  const { getFirebaseFunctions } = await import("@/lib/firebase");
  if (!getFirebaseFunctions()) return false;

  let allSynced = true;

  for (const entry of loadOutbox()) {
    try {
      if (entry.kind === "inventory") {
        const { syncPharmacyInventory } = await import("@/lib/cloud/pharmacy-inventory");
        await syncPharmacyInventory(entry.items);
      } else if (entry.kind === "sales") {
        const { syncPharmacySales } = await import("@/lib/cloud/pharmacy-sales");
        await syncPharmacySales(entry.sales);
      } else if (entry.kind === "shifts") {
        const { syncPharmacyShifts } = await import("@/lib/cloud/pharmacy-shifts");
        await syncPharmacyShifts(entry.shifts);
      } else if (entry.kind === "stock-requests") {
        const { syncPharmacyStockRequests } = await import("@/lib/cloud/stock-requests");
        await syncPharmacyStockRequests(entry.requests);
      } else {
        const { sendLowStockAlert } = await import("@/lib/cloud/low-stock-alerts");
        const stores = entry.stores;
        await sendLowStockAlert({
          items: entry.items,
          stores,
          pharmacyName: entry.pharmacyName,
          storeNameOf: (item) =>
            stores.find((store) => store.id === resolveStoreId(item))?.name ?? "",
        });
      }

      // Re-read before removing so a concurrent tab/queue write is preserved.
      saveOutbox(loadOutbox().filter((current) => current.id !== entry.id));
    } catch (error) {
      allSynced = false;
      saveOutbox(
        loadOutbox().map((current) =>
          current.id === entry.id
            ? {
                ...current,
                attempts: current.attempts + 1,
                lastAttemptAt: Date.now(),
                lastError:
                  error instanceof Error
                    ? error.message.slice(0, 300)
                    : "Sync failed",
              }
            : current
        )
      );
    }
  }

  return allSynced;
}
