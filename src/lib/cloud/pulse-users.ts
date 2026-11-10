"use client";

import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase";
import type { PulseRole } from "@/lib/pulse-rbac";
import { CloudFunctionError } from "@/lib/cloud/invitations";

/* ------------------------------------------------------------------ */
/* Pulse console access management                                     */
/* ------------------------------------------------------------------ */

export type PulseConsoleUser = {
  uid: string;
  name: string;
  email: string;
  role: PulseRole;
  roleLabel: string;
};

type ListResponse = { users: PulseConsoleUser[] };

/** Loads active Pulse profiles. Available to Owners and Admins. */
export async function listPulseConsoleUsers(): Promise<PulseConsoleUser[]> {
  const result = await invoke<ListResponse>("listPulseConsoleUsers", {});
  return result.users;
}

/** Owner-only: changes another console user's role. */
export async function updatePulseConsoleUserRole(
  uid: string,
  role: PulseRole
): Promise<void> {
  await invoke("updatePulseConsoleUserRole", { uid, role });
}

/** Owner-only: revokes a console user's profile and Firebase Auth access. */
export async function removePulseConsoleUser(uid: string): Promise<void> {
  await invoke("removePulseConsoleUser", { uid });
}

async function invoke<T = unknown>(
  name: string,
  payload: Record<string, unknown>
): Promise<T> {
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new CloudFunctionError(
      "unavailable",
      "The console access service isn't available right now."
    );
  }

  try {
    const callable = httpsCallable<Record<string, unknown>, T>(functions, name);
    const result = await callable(payload);
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
        : "We couldn't update console access. Please try again.";
    throw new CloudFunctionError(code, message);
  }
}
