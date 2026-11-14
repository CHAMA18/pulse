"use client";

import { httpsCallable } from "firebase/functions";
import type { AuditEvent } from "@/lib/audit-log";
import { getFirebaseFunctions } from "@/lib/firebase";

export type AuditLogFeed = {
  events: AuditEvent[];
  total: number;
  today: number;
  people: number;
};

type AuditEventPayload = Pick<
  AuditEvent,
  "id" | "title" | "action" | "detail" | "ts" | "email"
>;

/** Send a batched, authenticated audit write to Firestore. */
export async function recordAuditEvents(events: AuditEvent[]): Promise<void> {
  const functions = getFirebaseFunctions();
  if (!functions) throw new Error("The audit service is unavailable.");
  const callable = httpsCallable<{ events: AuditEventPayload[] }, { recorded: number }>(
    functions,
    "recordAuditEvents"
  );
  // The callable accepts up to 100 events per invocation.
  for (let offset = 0; offset < events.length; offset += 100) {
    const batch = events
      .slice(offset, offset + 100)
      .map(({ id, title, action, detail, ts, email }) => ({
        id,
        title,
        action,
        detail,
        ts,
        email,
      }));
    await callable({ events: batch });
  }
}

/** Read the complete Firestore audit trail. Pulse Owners/Admins only. */
export async function listAuditLogs(): Promise<AuditLogFeed> {
  const functions = getFirebaseFunctions();
  if (!functions) throw new Error("The audit service is unavailable.");
  const callable = httpsCallable<Record<string, never>, AuditLogFeed>(
    functions,
    "listAuditLogs"
  );
  const result = await callable({});
  return result.data;
}
