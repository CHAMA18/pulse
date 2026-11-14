"use client";

import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase";
import { CloudFunctionError } from "@/lib/cloud/invitations";

/** A pharmacy profile Pulse staff has prepared but the owner has not claimed. */
export type PharmacyProvisioning = {
  id: string;
  pharmacyName: string;
  ownerName: string;
  ownerEmail: string;
  address: string;
  createdAt: number;
  expiresAt: number;
  expired: boolean;
  createdByName: string;
};

export type CreatePharmacyProvisioningInput = {
  pharmacyName: string;
  ownerName: string;
  ownerEmail: string;
  address?: string;
  phone?: string;
};

export type CreatedPharmacyProvisioning = {
  id: string;
  otp: string;
  expiresAt: number;
  pharmacyName: string;
  ownerName: string;
  ownerEmail: string;
  address: string;
};

export type PharmacyOtpPreview = {
  provisioningId: string;
  pharmacyName: string;
  ownerName: string;
  ownerEmail: string;
  address: string;
  expiresAt: number;
};

export type ClaimedPharmacy = {
  uid: string;
  email: string;
  pharmacyName: string;
  ownerName: string;
};

function functionsOrThrow() {
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new CloudFunctionError(
      "unavailable",
      "The Pulse account service isn't available right now."
    );
  }
  return functions;
}

function toCloudError(error: unknown): CloudFunctionError {
  if (error instanceof CloudFunctionError) return error;
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code ?? "unknown")
      : "unknown";
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return new CloudFunctionError(code, message || "The account service couldn't complete that request.");
}

async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  try {
    const callable = httpsCallable<Input, Output>(functionsOrThrow(), name);
    const response = await callable(input);
    return response.data;
  } catch (error) {
    throw toCloudError(error);
  }
}

export async function createPharmacyProvisioning(
  input: CreatePharmacyProvisioningInput
): Promise<CreatedPharmacyProvisioning> {
  return call<CreatePharmacyProvisioningInput, CreatedPharmacyProvisioning>(
    "createPharmacyProvisioning",
    input
  );
}

export async function listPharmacyProvisioning(): Promise<PharmacyProvisioning[]> {
  const result = await call<Record<string, never>, { provisioning: PharmacyProvisioning[] }>(
    "listPharmacyProvisioning",
    {}
  );
  return Array.isArray(result.provisioning) ? result.provisioning : [];
}

export async function resolvePharmacyOtp(otp: string): Promise<PharmacyOtpPreview> {
  return call<{ otp: string }, PharmacyOtpPreview>("resolvePharmacyOtp", { otp });
}

export async function claimPharmacyOtp(otp: string): Promise<ClaimedPharmacy> {
  return call<{ otp: string }, ClaimedPharmacy>("claimPharmacyOtp", { otp });
}
