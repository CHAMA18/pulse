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

export type ApplicationDirectoryUser = {
  uid: string;
  name: string;
  email: string;
  accountType: "Pulse" | "Pharmacy" | "Other";
  role: PulseRole | "pharmacy" | "user";
  roleLabel: string;
  status: "active" | "invited" | "suspended" | "removed";
  source: "profile" | "invitation";
};

export type PharmacyDirectoryEntry = {
  /** The pharmacy owner's User document id. */
  uid: string;
  /** The shared pharmacy id every teammate profile points at. */
  id: string;
  name: string;
  email: string | null;
  address: string;
  approved: boolean;
  status: "active" | "pending" | "rejected" | "removed";
  previousStatus: "active" | "pending" | "rejected" | null;
  registeredAt: number | null;
  removedAt: number | null;
};

type ListResponse = { users: PulseConsoleUser[] };
type ApplicationUsersResponse = { users: ApplicationDirectoryUser[] };
type PharmacyListResponse = { pharmacies: PharmacyDirectoryEntry[] };

/** Loads active Pulse profiles. Available to Owners and Admins. */
export async function listPulseConsoleUsers(): Promise<PulseConsoleUser[]> {
  const result = await invoke<ListResponse>("listPulseConsoleUsers", {});
  return result.users;
}

/** Loads every registered application profile. Owners and Admins only. */
export async function listApplicationUsers(): Promise<ApplicationDirectoryUser[]> {
  const result = await invoke<ApplicationUsersResponse>("listApplicationUsers", {});
  return result.users;
}

/** Suspends, restores, or permanently deletes one registered account. */
export async function manageApplicationUser(
  uid: string,
  action: "suspend" | "reactivate" | "delete"
): Promise<void> {
  await invoke("manageApplicationUser", { uid, action });
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

/** Every pharmacy on the network, one row per pharmacy. Owners and Admins only. */
export async function listPulsePharmacies(): Promise<PharmacyDirectoryEntry[]> {
  const result = await invoke<PharmacyListResponse>("listPulsePharmacies", {});
  return result.pharmacies;
}

/** Owner/Admin: approves or rejects a pharmacy across all its profiles. */
export async function setPharmacyApproval(
  uid: string,
  status: "active" | "pending" | "rejected"
): Promise<void> {
  await invoke("setPharmacyApproval", { uid, status });
}

export async function updatePharmacyListing(
  uid: string,
  action: "remove" | "restore",
  options: {
    approved?: boolean;
    previousStatus?: string;
    status?: "active" | "pending" | "rejected";
  } = {}
): Promise<void> {
  await invoke("updatePharmacyListing", { uid, action, ...options });
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
