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
  comments?: StockRequestComment[];
  returnedAt?: number;
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

export type StockRequestAttachment = {
  path: string;
  name: string;
  contentType: string;
  size: number;
};

export type StockRequestComment = {
  id: string;
  side: "pulse" | "pharmacy";
  author: string;
  comment: string;
  attachments: StockRequestAttachment[];
  createdAt: number;
};

const STOCK_REQUEST_FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function validateStockRequestFiles(files: File[]): string | null {
  if (files.length > 5) return "Attach up to 5 files to each stock request.";
  for (const file of files) {
    if (!STOCK_REQUEST_FILE_TYPES.has(file.type.toLowerCase())) {
      return `${file.name} must be a PDF, Word document, or image.`;
    }
    if (file.size < 1 || file.size > 10 * 1024 * 1024) {
      return `${file.name} must be 10 MB or smaller.`;
    }
  }
  return null;
}

export async function uploadStockRequestFiles(docId: string, files: File[]): Promise<StockRequestAttachment[]> {
  if (!files.length) return [];
  const validationError = validateStockRequestFiles(files);
  if (validationError) throw new Error(validationError);
  const { getFirebaseAuth, getFirebaseStorage } = await import("@/lib/firebase");
  const user = getFirebaseAuth()?.currentUser;
  const storage = getFirebaseStorage();
  if (!user || !storage) throw new Error("Sign in before uploading request attachments.");
  const { ref, uploadBytes } = await import("firebase/storage");
  return Promise.all(files.map(async (file) => {
    const contentType = file.type.toLowerCase();
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "attachment";
    const path = `stock-request-attachments/${docId}/${user.uid}/${crypto.randomUUID()}-${safeName}`;
    await uploadBytes(ref(storage, path), file, { contentType });
    return { path, name: file.name.slice(0, 180), contentType, size: file.size };
  }));
}

export async function openStockRequestAttachment(attachment: StockRequestAttachment): Promise<void> {
  const storage = (await import("@/lib/firebase")).getFirebaseStorage();
  if (!storage) throw new Error("File storage is not available.");
  const { getBlob, ref } = await import("firebase/storage");
  const blob = await getBlob(ref(storage, attachment.path));
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.name;
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function respondToStockRequest(input: {
  docId: string;
  comment: string;
  files: File[];
  returnToPharmacy?: boolean;
}): Promise<NetworkStockRequest> {
  const attachments = await uploadStockRequestFiles(input.docId, input.files);
  const functions = functionsOrThrow();
  const callable = httpsCallable<{
    docId: string;
    comment: string;
    attachments: StockRequestAttachment[];
    returnToPharmacy?: boolean;
  }, { request: NetworkStockRequest }>(functions, "respondToStockRequest");
  const result = await callable({
    docId: input.docId,
    comment: input.comment,
    attachments,
    ...(input.returnToPharmacy ? { returnToPharmacy: true } : {}),
  });
  return result.data.request;
}

export type StockRequestSyncResult = {
  created: number;
  skipped: number;
  emailed: number;
  requestDocs: { docId: string; requestId: string; syncId: string }[];
  emailError?: string;
};

export type StockRequestSubmitResult = StockRequestSyncResult & {
  queued: boolean;
  /** Set when the local row was saved but the network rejected the send. */
  error?: string;
  attachmentError?: string;
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
  const total: StockRequestSyncResult = { created: 0, skipped: 0, emailed: 0, requestDocs: [] };
  for (let offset = 0; offset < requests.length; offset += 50) {
    const chunk = requests.slice(offset, offset + 50);
    if (chunk.length === 0) continue;
    const result = await callable({ requests: chunk.map(networkPayload) });
    total.created += result.data.created;
    total.skipped += result.data.skipped;
    total.emailed += result.data.emailed;
    total.requestDocs.push(...(result.data.requestDocs ?? []));
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
  requests: StockRequest[],
  filesBySyncId: Record<string, File[]> = {}
): Promise<StockRequestSubmitResult> {
  if (requests.length === 0) {
    return { created: 0, skipped: 0, emailed: 0, requestDocs: [], queued: false };
  }
  try {
    const result = await syncPharmacyStockRequests(requests);
    let attachmentError: string | undefined;
    const filesByRequest = new Map(
      result.requestDocs.map((entry) => [entry.syncId, filesBySyncId[entry.syncId] ?? []])
    );
    const withFiles = result.requestDocs.filter((entry) => (filesByRequest.get(entry.syncId)?.length ?? 0) > 0);
    if (withFiles.length > 0) {
      if (result.requestDocs.length === 0) {
        attachmentError = "The request reached Pulse, but the server needs an update before it can attach files.";
      } else {
        const outcomes = await Promise.allSettled(withFiles.map((entry) =>
          respondToStockRequest({
            docId: entry.docId,
            comment: "",
            files: filesByRequest.get(entry.syncId) ?? [],
          })
        ));
        const failures = outcomes.filter((outcome) => outcome.status === "rejected");
        if (failures.length > 0) {
          const detail = failures[0]?.status === "rejected" && failures[0].reason instanceof Error
            ? failures[0].reason.message
            : "Try again from the request conversation.";
          attachmentError = `${failures.length} request${failures.length === 1 ? "" : "s"} sent, but some attachments could not be uploaded. ${detail}`;
        }
      }
    }
    return { ...result, queued: false, ...(attachmentError ? { attachmentError } : {}) };
  } catch (error) {
    const cloudError = toCloudError(error, "The stock request could not be sent to Pulse.");
    if (isTransient(cloudError)) {
      const { queueStockRequests } = await import("@/lib/offline/outbox");
      queueStockRequests(requests);
      return {
        created: 0,
        skipped: 0,
        emailed: 0,
        requestDocs: [],
        queued: true,
        emailError: cloudError.message,
        ...(Object.values(filesBySyncId).some((files) => files.length) ? {
          attachmentError: "The request was saved for sending, but attachments require a connection. Once it syncs, add them from the request conversation.",
        } : {}),
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
