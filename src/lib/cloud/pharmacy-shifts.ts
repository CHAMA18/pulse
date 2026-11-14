"use client";

import { httpsCallable } from "firebase/functions";
import type { PharmacyShift } from "@/lib/pharmacy-shifts";
import { getFirebaseFunctions } from "@/lib/firebase";

/** Mirrors shift open/close records to the pharmacy's authenticated cloud trail. */
export async function syncPharmacyShifts(shifts: PharmacyShift[]): Promise<void> {
  const functions = getFirebaseFunctions();
  if (!functions || shifts.length === 0) return;

  const sync = httpsCallable<{ shifts: PharmacyShift[] }, { synced: number }>(
    functions,
    "syncPharmacyShifts"
  );
  const chunkSize = 20;
  for (let offset = 0; offset < shifts.length; offset += chunkSize) {
    await sync({ shifts: shifts.slice(offset, offset + chunkSize) });
  }
}
