"use client";

import { httpsCallable } from "firebase/functions";
import type { POSSale } from "@/components/pharmacy/pharmacy-data";
import { getFirebaseFunctions } from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Pulse Cloud — POS receipt email                                     */
/* ------------------------------------------------------------------ */
/* The browser sends only the receipt details. The callable resolves   */
/* the pharmacy's registered trading name and logo mark from the       */
/* authenticated profile, then delivers through Resend.                */

export type ReceiptEmailInput = {
  email: string;
  sale: POSSale;
  /** The counter's store; falls back to the sale's stored name. */
  storeName: string;
};

export type ReceiptEmailResult = {
  messageId: string;
  to?: string;
};

export class ReceiptEmailError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReceiptEmailError";
    this.code = code;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Emails one completed sale receipt through the `sendReceiptEmail` callable. */
export async function sendReceiptEmail(input: ReceiptEmailInput): Promise<ReceiptEmailResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new ReceiptEmailError("invalid-argument", "Enter a valid email address.");
  }
  if (input.sale.lines.length === 0) {
    throw new ReceiptEmailError("invalid-argument", "This receipt has no items to send.");
  }

  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new ReceiptEmailError(
      "unavailable",
      "Email delivery isn't available right now. Check your connection and try again."
    );
  }

  const payload = {
    email,
    receipt: {
      id: input.sale.id,
      storeName: input.storeName.trim() || input.sale.storeName || "Main store",
      soldAt: input.sale.soldAt,
      lines: input.sale.lines.map((line) => ({
        name: line.name,
        qty: line.qty,
        unitPrice: line.unitPrice,
      })),
      subtotal: input.sale.subtotal,
      discount: input.sale.discount,
      total: input.sale.total,
      method: input.sale.method,
      ...(input.sale.method === "cash"
        ? { tendered: input.sale.tendered ?? 0, change: input.sale.change ?? 0 }
        : {}),
      servedBy: input.sale.servedBy,
    },
  };

  try {
    const call = httpsCallable<typeof payload, ReceiptEmailResult>(functions, "sendReceiptEmail");
    const result = await call(payload);
    return result.data;
  } catch (err) {
    const raw = err as { code?: unknown; message?: unknown } | null;
    const code =
      typeof raw?.code === "string"
        ? raw.code.replace(/^functions\//, "")
        : "unavailable";
    const message =
      typeof raw?.message === "string" && raw.message
        ? raw.message
        : "We couldn't email this receipt. Please try again.";
    throw new ReceiptEmailError(code, message);
  }
}
