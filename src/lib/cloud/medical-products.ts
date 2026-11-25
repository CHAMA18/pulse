"use client";

import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase";

export type MedicalProduct = {
  id: string;
  name: string;
  category: string;
  normalizedName: string;
  createdAt?: number;
};

function functionsOrThrow() {
  const functions = getFirebaseFunctions();
  if (!functions) throw new Error("The shared medical product register is unavailable.");
  return functions;
}

export async function listMedicalProducts(
  query = "",
  cursor?: string | null
): Promise<{ products: MedicalProduct[]; nextCursor: string | null }> {
  const callable = httpsCallable<
    { query: string; cursor?: string },
    { products: MedicalProduct[]; nextCursor: string | null }
  >(
    functionsOrThrow(),
    "listMedicalProducts"
  );
  const result = await callable({ query, ...(cursor ? { cursor } : {}) });
  return {
    products: Array.isArray(result.data.products) ? result.data.products : [],
    nextCursor: result.data.nextCursor ?? null,
  };
}

export async function ensureMedicalProductSearchIndex(): Promise<void> {
  const callable = httpsCallable<
    Record<string, never>,
    { done: boolean; busy?: boolean; indexed?: number }
  >(functionsOrThrow(), "backfillMedicalProductSearchIndex");
  let done = false;
  while (!done) {
    const result = await callable({});
    done = result.data.done;
    if (result.data.busy) await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
}

export async function registerMedicalProduct(input: {
  name: string;
  category: string;
}): Promise<{ product: MedicalProduct; created: boolean }> {
  const callable = httpsCallable<typeof input, { product: MedicalProduct; created: boolean }>(
    functionsOrThrow(),
    "registerMedicalProduct"
  );
  const result = await callable(input);
  return result.data;
}

export async function syncPharmacyMedicalProducts(
  products: Array<Pick<MedicalProduct, "name" | "category">>
): Promise<number> {
  const callable = httpsCallable<
    { products: Array<Pick<MedicalProduct, "name" | "category">> },
    { synced: number }
  >(functionsOrThrow(), "syncPharmacyMedicalProducts");
  let synced = 0;
  for (let offset = 0; offset < products.length; offset += 400) {
    const result = await callable({ products: products.slice(offset, offset + 400) });
    synced += result.data.synced;
  }
  return synced;
}
