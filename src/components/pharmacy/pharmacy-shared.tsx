"use client";

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Shared bits for the Pharmacy portal console                          */
/* ------------------------------------------------------------------ */
/* The Pharmacy portal wears the same Pulse identity as the rest of    */
/* the product — the purple/fuchsia brand — so the whole app feels     */
/* like one family after authentication.                               */

export const PHARMACY_WORKSPACE = "Pharmacy workspace";

/** Card surface — same geometry as the console, purple-tinted shadows. */
export const pharmacyCardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";

/** Purple brand button (mirrors the console's btn-brand). */
export const brandBtnCls =
  "inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white shadow-[0_8px_22px_-8px_rgba(147,51,234,0.65)] transition-shadow hover:shadow-[0_12px_28px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500";

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  tourId,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  /** Walkthrough spotlight anchor — set to the page's data-tour id. */
  tourId?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3" data-tour={tourId}>
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
      </span>
      <div className="min-w-[min(100%,220px)] flex-1">
        <h2 className="text-[21px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="text-[13.5px] text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:ml-auto sm:w-auto sm:shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}

/** Soft pill for stock / request / delivery states. */
const STATUS_PILLS: Record<string, string> = {
  healthy: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  low: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  out: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  approved: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  dispatched: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  cancelled: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  urgent: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  routine: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  verified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold capitalize",
        STATUS_PILLS[status] ?? STATUS_PILLS.cancelled
      )}
    >
      {label ?? status}
    </span>
  );
}

/** Stock status derived from quantity vs. reorder level. */
export type StockStatus = "healthy" | "low" | "out";

export function stockStatusOf(qty: number, reorderLevel: number): StockStatus {
  if (qty <= 0) return "out";
  if (qty <= reorderLevel) return "low";
  return "healthy";
}

/* ------------------------------------------------------------------ */
/* localStorage store helpers                                          */
/* ------------------------------------------------------------------ */

/** Persists a list to localStorage (best-effort). */
export function savePharmacyList<T>(key: string, list: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage full or unavailable — persistence is best-effort */
  }
}
