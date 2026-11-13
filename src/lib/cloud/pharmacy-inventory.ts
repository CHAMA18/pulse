"use client";

import { httpsCallable } from "firebase/functions";
import type { InventoryItem } from "@/components/pharmacy/pharmacy-data";
import { getFirebaseFunctions } from "@/lib/firebase";

export type NetworkInventoryItem = InventoryItem & {
  docId: string;
  pharmacyId: string;
  pharmacyName: string;
  storeName?: string;
};

export type NetworkInventoryPage = {
  items: NetworkInventoryItem[];
  pharmacies: { id: string; name: string }[];
};

/** Mirrors this pharmacy's shelves to the network stock picture. */
export async function syncPharmacyInventory(
  items: (InventoryItem & { storeName?: string })[]
): Promise<void> {
  const functions = getFirebaseFunctions();
  if (!functions) return;
  const sync = httpsCallable<{ items: unknown[] }, { synced: number }>(
    functions,
    "syncPharmacyInventory"
  );
  const chunkSize = 200;
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    await sync({ items: items.slice(offset, offset + chunkSize) });
  }
  if (items.length === 0) await sync({ items: [] });
}

/** Every registered pharmacy's shelves. The callable enforces Pulse Owner/Admin access. */
export async function listNetworkInventory(limit = 500): Promise<NetworkInventoryPage> {
  const functions = getFirebaseFunctions();
  if (!functions) throw new Error("The Pulse inventory service is unavailable.");
  const list = httpsCallable<{ limit: number }, NetworkInventoryPage>(
    functions,
    "listNetworkInventory"
  );
  const result = await list({ limit });
  return result.data;
}
