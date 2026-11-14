"use client";

import { httpsCallable } from "firebase/functions";
import type { StockRequest, RequestStatus, RequestPriority } from "@/components/pharmacy/pharmacy-data";
import { getFirebaseFunctions } from "@/lib/firebase";
import { CloudFunctionError } from "@/lib/cloud/invitations";
import type {
  ReconciliationLineInput,
  ReconciliationLine,
  ReconciliationTotals,
} from "@/lib/stock-reconciliation";

/* ------------------------------------------------------------------ */
/* Network stock requests                                             */
/* ------------------------------------------------------------------ */

export type NetworkStockRequest = {
  docId: string;
  requestId: string;
  syncId?: string;
  pharmacyId: string;
  pharmacyName: string;
  storeId: string;
  storeName: string;
  item: string;
  productId?: string;
  qty: number;
  priority: RequestPriority;
  notes?: string;
  status: RequestStatus;
  submittedAt: number;
  submittedByName: string;
  submittedByEmail: string;
  unitCost?: number;
  markupPercent?: number;
  duniyaUnitPrice?: number;
  totalCost?: number;
  totalDuniya?: number;
  batch?: string;
  expiry?: string;
  dispatchNote?: string;
  dispatchedAt?: number;
  dispatchedBy?: string;
  decisionNote?: string;
  rejectedAt?: number;
  retailUnitPrice?: number;
  totalRetail?: number;
  deliveredAt?: number;
  receivedBy?: string;
  approvedAt?: number;
  approvedBy?: string;
  /** Set by the receive callable when a retry finds the line already closed. */
  alreadyDelivered?: boolean;
};

export type StockRequestSyncResult = {
  created: number;
  skipped: number;
  emailed: number;
  emailError?: string;
};

export type StockRequestSubmitResult = StockRequestSyncResult & {
  queued: boolean;
  /** Set when the local row was saved but the network rejected the send. */
  error?: string;
};

function functionsOrThrow() {
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new CloudFunctionError(
      "unavailable",
      "The Pulse stock service isn't available right now."
    );
  }
  return functions;
}

function toCloudError(error: unknown, fallback: string): CloudFunctionError {
  if (error instanceof CloudFunctionError) return error;
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = typeof raw?.code === "string" ? raw.code.replace(/^functions\//, "") : "unavailable";
  const message =
    typeof raw?.message === "string" && raw.message ? raw.message : fallback;
  return new CloudFunctionError(code, message);
}

function isTransient(error: CloudFunctionError): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return ["unavailable", "deadline-exceeded", "internal", "unknown", "aborted"].includes(
    error.code
  );
}

function syncIdOf(request: StockRequest): string {
  if (request.syncId) return request.syncId;
  // Legacy rows have no network id. The display id plus submission time is
  // unique enough, and the server hashes it per pharmacy.
  return `${request.id}-${request.submittedAt.toString(36)}`;
}

function networkPayload(request: StockRequest) {
  return {
    requestId: request.id,
    syncId: syncIdOf(request),
    item: request.item,
    qty: request.qty,
    priority: request.priority,
    storeId: request.storeId ?? "st-main",
    storeName: request.storeName ?? "Main store",
    ...(request.productId ? { productId: request.productId } : {}),
    ...(request.notes ? { notes: request.notes } : {}),
  };
}

/** Direct network send used by the UI and by the offline outbox (no re-queue). */
export async function syncPharmacyStockRequests(
  requests: StockRequest[]
): Promise<StockRequestSyncResult> {
  const functions = functionsOrThrow();
  const callable = httpsCallable<{ requests: unknown[] }, StockRequestSyncResult>(
    functions,
    "createPharmacyStockRequests"
  );
  const total: StockRequestSyncResult = { created: 0, skipped: 0, emailed: 0 };
  for (let offset = 0; offset < requests.length; offset += 50) {
    const chunk = requests.slice(offset, offset + 50);
    if (chunk.length === 0) continue;
    const result = await callable({ requests: chunk.map(networkPayload) });
    total.created += result.data.created;
    total.skipped += result.data.skipped;
    total.emailed += result.data.emailed;
    if (result.data.emailError) total.emailError = result.data.emailError;
  }
  return total;
}

/**
 * Local-first submission: tries the Pulse queue immediately and falls back to
 * the durable outbox when the network is down. The accepted retry path is
 * idempotent, so a reconnect never duplicates a request.
 */
export async function submitPharmacyStockRequests(
  requests: StockRequest[]
): Promise<StockRequestSubmitResult> {
  if (requests.length === 0) {
    return { created: 0, skipped: 0, emailed: 0, queued: false };
  }
  try {
    const result = await syncPharmacyStockRequests(requests);
    return { ...result, queued: false };
  } catch (error) {
    const cloudError = toCloudError(error, "The stock request could not be sent to Pulse.");
    if (isTransient(cloudError)) {
      const { queueStockRequests } = await import("@/lib/offline/outbox");
      queueStockRequests(requests);
      return {
        created: 0,
        skipped: 0,
        emailed: 0,
        queued: true,
        emailError: cloudError.message,
      };
    }
    throw cloudError;
  }
}

export async function listMyPharmacyStockRequests(): Promise<NetworkStockRequest[]> {
  const functions = functionsOrThrow();
  const callable = httpsCallable<Record<string, never>, { requests: NetworkStockRequest[] }>(
    functions,
    "listMyPharmacyStockRequests"
  );
  const result = await callable({});
  return result.data.requests;
}

export async function cancelPharmacyStockRequest(
  docId: string,
  reason = "Withdrawn by pharmacy"
): Promise<NetworkStockRequest> {
  const functions = functionsOrThrow();
  const callable = httpsCallable<{ docId: string; reason: string }, { request: NetworkStockRequest }>(
    functions,
    "cancelPharmacyStockRequest"
  );
  const result = await callable({ docId, reason });
  return result.data.request;
}

export async function receivePharmacyStockRequest(
  docId: string,
  retailUnitPrice: number
): Promise<NetworkStockRequest> {
  const functions = functionsOrThrow();
  const callable = httpsCallable<
    { docId: string; retailUnitPrice: number },
    { request: NetworkStockRequest }
  >(functions, "receivePharmacyStockRequest");
  const result = await callable({ docId, retailUnitPrice });
  return result.data.request;
}

/* ------------------------------------------------------------------ */
/* Pulse receiving desk                                               */
/* ------------------------------------------------------------------ */

export async function listReceivedStockRequests(limit = 500): Promise<NetworkStockRequest[]> {
  const functions = functionsOrThrow();
  const callable = httpsCallable<{ limit: number }, { requests: NetworkStockRequest[] }>(
    functions,
    "listReceivedStockRequests"
  );
  const result = await callable({ limit });
  return result.data.requests;
}

export async function updateReceivedStockRequest(input: {
  docId: string;
  action: "approve" | "reject" | "dispatch";
  reason?: string;
  unitCost?: number;
  markupPercent?: number;
  batch?: string;
  expiry?: string;
  note?: string;
}): Promise<NetworkStockRequest> {
  const functions = functionsOrThrow();
  const callable = httpsCallable<typeof input, { request: NetworkStockRequest }>(
    functions,
    "updateReceivedStockRequest"
  );
  const result = await callable(input);
  return result.data.request;
}

/* ------------------------------------------------------------------ */
/* Reconciliation history                                             */
/* ------------------------------------------------------------------ */

export type ReconciliationSummary = {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  storeId: string;
  storeName: string;
  completedAtMs: number;
  nextDueAt: number;
  auditor: string;
  auditorEmail: string;
  notes?: string;
  lineCount: number;
  totals: ReconciliationTotals;
  shortLines: number;
};

export type ReconciliationRecord = ReconciliationSummary & {
  lines: ReconciliationLine[];
  status: "completed";
};

export async function savePharmacyReconciliation(input: {
  pharmacyId: string;
  pharmacyName: string;
  storeId: string;
  storeName: string;
  notes?: string;
  lines: ReconciliationLineInput[];
}): Promise<ReconciliationSummary> {
  const functions = functionsOrThrow();
  const callable = httpsCallable<typeof input, ReconciliationSummary>(
    functions,
    "savePharmacyReconciliation"
  );
  const result = await callable(input);
  return result.data;
}

export async function listPharmacyReconciliations(
  limit = 100
): Promise<ReconciliationSummary[]> {
  const functions = functionsOrThrow();
  const callable = httpsCallable<
    { limit: number },
    { reconciliations: ReconciliationSummary[] }
  >(functions, "listPharmacyReconciliations");
  const result = await callable({ limit });
  return result.data.reconciliations;
}

export async function getPharmacyReconciliation(
  id: string
): Promise<ReconciliationRecord> {
  const functions = functionsOrThrow();
  const callable = httpsCallable<{ id: string }, { reconciliation: ReconciliationRecord }>(
    functions,
    "getPharmacyReconciliation"
  );
  const result = await callable({ id });
  return result.data.reconciliation;
}
