"use client";

import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase";
import { CloudFunctionError } from "@/lib/cloud/invitations";

export type PharmacyCleanupResult = {
  uid: string;
  deletedAuthUsers: number;
  deletedProfiles: number;
  deletedInventory: number;
  deletedAlerts: number;
  deletedInvitations: number;
  authErrors: string[];
};

/**
 * Permanently removes a pharmacy listing that has already been soft-deleted.
 * The callable removes linked accounts, inventory, alerts and invitations;
 * sales history is retained for reporting.
 */
export async function hardDeletePharmacyAccount(
  uid: string
): Promise<PharmacyCleanupResult> {
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new CloudFunctionError(
      "unavailable",
      "The pharmacy cleanup service isn't available right now."
    );
  }

  try {
    const callable = httpsCallable<{ uid: string }, PharmacyCleanupResult>(
      functions,
      "deletePharmacyAccount"
    );
    const result = await callable({ uid });
    return result.data;
  } catch (error) {
    if (error instanceof CloudFunctionError) throw error;
    const raw = error as { code?: unknown; message?: unknown } | null;
    const code =
      typeof raw?.code === "string"
        ? raw.code.replace(/^functions\//, "")
        : "unavailable";
    const message =
      typeof raw?.message === "string" && raw.message
        ? raw.message
        : "The pharmacy could not be permanently deleted. Please try again.";
    throw new CloudFunctionError(code, message);
  }
}
