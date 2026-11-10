"use client";

import { httpsCallable } from "firebase/functions";
import type { POSSale } from "@/components/pharmacy/pharmacy-data";
import { getFirebaseFunctions } from "@/lib/firebase";

export type NetworkPharmacySale = POSSale & {
  docId: string;
  pharmacyId: string;
  pharmacyName: string;
};

export type NetworkPharmacy = {
  id: string;
  name: string;
};

export type NetworkSalesPage = {
  sales: NetworkPharmacySale[];
  pharmacies: NetworkPharmacy[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** Safely mirrors local POS records to the pharmacy's authenticated cloud feed. */
export async function syncPharmacySales(sales: POSSale[]): Promise<void> {
  const functions = getFirebaseFunctions();
  if (!functions || sales.length === 0) return;

  const sync = httpsCallable<{ sales: POSSale[] }, { synced: number }>(
    functions,
    "syncPharmacySales"
  );
  const chunkSize = 40;
  for (let offset = 0; offset < sales.length; offset += chunkSize) {
    await sync({ sales: sales.slice(offset, offset + chunkSize) });
  }
}

/** Lists one page of network sales. The callable enforces Pulse Owner/Admin access. */
export async function listNetworkPharmacySales(input: {
  startAt?: number;
  endAt?: number;
  cursor?: string;
  limit?: number;
} = {}): Promise<NetworkSalesPage> {
  const functions = getFirebaseFunctions();
  if (!functions) throw new Error("The Pulse sales service is unavailable.");

  const list = httpsCallable<typeof input, NetworkSalesPage>(
    functions,
    "listNetworkPharmacySales"
  );
  const result = await list(input);
  return result.data;
}
