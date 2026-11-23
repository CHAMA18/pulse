"use client";

import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase";
import { CloudFunctionError } from "@/lib/cloud/invitations";

/* ------------------------------------------------------------------ */
/* Pharmacy team access                                                */
/* ------------------------------------------------------------------ */
/* Role changes, suspensions and removals are authorized on the server */
/* against the caller's own pharmacy profile. The browser only names a */
/* teammate by email; it never edits another User document.            */

export type PharmacyTeamChange =
  | { action: "role"; role: string }
  | { action: "suspend" | "reactivate" | "remove" };

export async function updatePharmacyTeamMember(
  email: string,
  change: PharmacyTeamChange
): Promise<void> {
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new CloudFunctionError(
      "unavailable",
      "Team access management isn't available right now."
    );
  }

  try {
    const callable = httpsCallable<Record<string, unknown>, { updated?: number }>(
      functions,
      "updatePharmacyTeamMember"
    );
    await callable({ email, ...change });
  } catch (error) {
    if (error instanceof CloudFunctionError) throw error;
    const raw = error as { code?: unknown; message?: unknown } | null;
    const code =
      typeof raw?.code === "string" ? raw.code.replace(/^functions\//, "") : "unavailable";
    const message =
      typeof raw?.message === "string" && raw.message
        ? raw.message
        : "We couldn't update that teammate's access. Please try again.";
    throw new CloudFunctionError(code, message);
  }
}
