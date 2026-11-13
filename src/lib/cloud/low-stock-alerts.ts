"use client";

import { httpsCallable } from "firebase/functions";
import {
  loadPharmacySettings,
  resolveStoreId,
  type InventoryItem,
  type PharmacyStore,
} from "@/components/pharmacy/pharmacy-data";
import { getFirebaseFunctions } from "@/lib/firebase";
import { lowStockLimitFor, storeLowStockLimit, triggeredLowStock } from "@/lib/pharmacy-stock";

export type LowStockAlertResult = {
  sent: boolean;
  reason?: "no-triggers" | "no-recipient" | "throttled" | "offline" | string;
  itemCount?: number;
  recipients?: string[];
  nextEligibleAt?: string;
};

/** Splits the configured mailbox list ("a@x.com, b@y.com") into clean addresses. */
export function parseAlertRecipients(value: string): string[] {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(/[,;\s]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

/**
 * Posts every shelf at or below its store's trigger limit so the
 * `sendLowStockAlert` callable can send one consolidated email to every
 * configured recipient. Settings decide the limits, the mailboxes and whether
 * alerts are on at all; the server throttles repeats.
 */
export async function sendLowStockAlert(input: {
  items: InventoryItem[];
  /** Branch list — stores with their own trigger limit override the default. */
  stores?: PharmacyStore[];
  /** Resolves the store display name written into the email. */
  storeNameOf?: (_item: InventoryItem) => string | undefined;
  pharmacyName?: string;
}): Promise<LowStockAlertResult> {
  const settings = loadPharmacySettings();
  if (!settings.lowStockAlerts) return { sent: false, reason: "alerts-off" };

  const stores = input.stores ?? [];
  const limitForItem = (item: InventoryItem) =>
    lowStockLimitFor(
      item,
      storeLowStockLimit(
        stores.find((store) => store.id === resolveStoreId(item)),
        settings.lowStockThreshold
      )
    );

  const triggered = triggeredLowStock(input.items, limitForItem);
  if (triggered.length === 0) return { sent: false, reason: "no-triggers" };

  const functions = getFirebaseFunctions();
  if (!functions) return { sent: false, reason: "offline" };

  const call = httpsCallable<
    {
      triggerLimit: number;
      email: string;
      pharmacyName: string;
      items: {
        name: string;
        category: string;
        batch: string;
        qty: number;
        reorderLevel: number;
        storeName: string;
        triggerLimit: number;
      }[];
    },
    LowStockAlertResult
  >(functions, "sendLowStockAlert");

  const result = await call({
    triggerLimit: settings.lowStockThreshold,
    email: settings.lowStockAlertEmail,
    pharmacyName: input.pharmacyName ?? "",
    items: triggered.map((item) => ({
      name: item.name,
      category: item.category,
      batch: item.batch,
      qty: item.qty,
      reorderLevel: item.reorderLevel,
      storeName: input.storeNameOf?.(item) ?? "",
      triggerLimit: limitForItem(item),
    })),
  });

  return result.data;
}
