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

export async function listMedicalProducts(query = ""): Promise<MedicalProduct[]> {
  const callable = httpsCallable<{ query: string }, { products: MedicalProduct[] }>(
    functionsOrThrow(),
    "listMedicalProducts"
  );
  const result = await callable({ query });
  return Array.isArray(result.data.products) ? result.data.products : [];
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
