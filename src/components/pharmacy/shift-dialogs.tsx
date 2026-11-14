"use client";

import { Banknote, CheckCircle2, Loader2, LockKeyhole, TriangleAlert } from "lucide-react";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { flushOutbox } from "@/lib/offline/outbox";
import {
  closeShift,
  formatShiftZMW,
  openShift,
  shiftTotals,
  varianceLabel,
  type PharmacyShift,
  type ShiftActor,
} from "@/lib/pharmacy-shifts";
import type { POSSale } from "@/components/pharmacy/pharmacy-data";
import { recordAudit } from "@/lib/audit-log";
import { getFirebaseAuth } from "@/lib/firebase";
import { clearStoredPortal } from "@/lib/portal";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { brandBtnCls } from "@/components/pharmacy/pharmacy-shared";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function money(value: number): string {
  return formatShiftZMW(value);
}

function signedMoney(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${money(Math.abs(value))}`;
}

/* ------------------------------------------------------------------ */
/* Open shift                                                          */
/* ------------------------------------------------------------------ */

export function OpenShiftDialog({
  open,
  onOpenChange,
  actor,
  store,
  onOpened,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  actor: ShiftActor;
  store?: { id: string; name: string };
  onOpened: (_shift: PharmacyShift) => void;
}) {
  const { toast } = useToast();
  const [float, setFloat] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setFloat("0");
      setError("");
      setSaving(false);
    }
  }

  const openingFloat = Number.parseFloat(float);
  const valid = Boolean(store) && Number.isFinite(openingFloat) && openingFloat >= 0;

  const submit = async () => {
    if (!store || saving) return;
    setSaving(true);
    setError("");
    try {
      const shift = openShift({
        actor,
        storeId: store.id,
        storeName: store.name,
        openingFloat,
      });
      const { queueShiftSync } = await import("@/lib/offline/outbox");
      queueShiftSync([shift]);
      await flushOutbox();
      if (actor.email) {
        recordAudit({
          title: "Shift Opened",
          action: "Update",
          detail: `${shift.id} · ${shift.storeName} · opening float ${money(shift.openingFloat)}`,
          actor: actor.name,
          email: actor.email,
        });
      }
      toast({
        title: `${shift.id} opened`,
        description: `${shift.storeName} is ready. Opening float ${money(shift.openingFloat)}.`,
      });
      onOpened(shift);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The shift could not be opened.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-purple-600 dark:text-purple-400" aria-hidden="true" />
            Open a shift
          </DialogTitle>
          <DialogDescription>
            Start the till for {store?.name ?? "this store"}. Count the opening float — the cash
            already in the drawer — so the close-out reconciles exactly.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-[12.5px] text-slate-600 dark:bg-white/5 dark:text-slate-300">
            <p className="font-semibold text-slate-800 dark:text-slate-100">{actor.name || "Cashier"}</p>
            <p className="mt-0.5 text-slate-500 dark:text-slate-400">{actor.email || "Sign in required"}</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="shift-opening-float">Opening float (ZMW)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-slate-400">
                K
              </span>
              <input
                id="shift-opening-float"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={float}
                onChange={(event) => {
                  setFloat(event.target.value);
                  setError("");
                }}
                className="h-11 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-[14px] font-semibold tabular-nums outline-none transition-[border-color,box-shadow] focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
                aria-describedby="shift-opening-float-hint"
              />
            </div>
            <p id="shift-opening-float-hint" className="text-[11.5px] leading-snug text-slate-400 dark:text-slate-500">
              Include all notes and coins handed to you at the start of the shift.
            </p>
          </div>

          {!actor.email && (
            <p role="alert" className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
              Sign in to open a shift.
            </p>
          )}
          {!store && (
            <p role="alert" className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
              Add a store before opening the till.
            </p>
          )}
          {error && (
            <p role="alert" className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || saving}
            className={cn(brandBtnCls, "h-10 px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40")}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Banknote className="h-4 w-4" aria-hidden="true" />}
            {saving ? "Opening…" : "Open shift"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Close shift + handover                                              */
/* ------------------------------------------------------------------ */

export function CloseShiftDialog({
  open,
  onOpenChange,
  shift,
  sales,
  actor,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  shift: PharmacyShift | null;
  sales: POSSale[];
  actor: ShiftActor;
  onClosed: (_shift: PharmacyShift) => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [handoverTo, setHandoverTo] = useState("");
  const [signOutAfter, setSignOutAfter] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevShiftId, setPrevShiftId] = useState<string | null>(null);

  if (open !== prevOpen || (shift?.id ?? null) !== prevShiftId) {
    setPrevOpen(open);
    setPrevShiftId(shift?.id ?? null);
    if (open) {
      setCounted("");
      setNotes("");
      setHandoverTo("");
      setSignOutAfter(true);
      setError("");
      setSaving(false);
    }
  }

  const totals = shift ? shiftTotals(shift, sales) : null;
  const countedNum = Number.parseFloat(counted);
  const hasCount = counted.trim() !== "" && Number.isFinite(countedNum) && countedNum >= 0;
  const variance = totals && hasCount ? Math.round((countedNum - totals.expectedCash) * 100) / 100 : 0;
  const needsNote = hasCount && Math.abs(variance) >= 0.01;
  const valid = Boolean(shift) && hasCount && (!needsNote || notes.trim().length >= 3);

  const submit = async () => {
    if (!shift || !valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const closed = closeShift({
        shiftId: shift.id,
        countedCash: countedNum,
        closingNotes: notes,
        handoverTo,
        actor,
      });
      const { queueShiftSync } = await import("@/lib/offline/outbox");
      queueShiftSync([closed]);
      await flushOutbox();
      if (actor.email) {
        recordAudit({
          title: "Shift Closed",
          action: "Update",
          detail: `${closed.id} · expected ${money(closed.expectedCash ?? 0)} · counted ${money(
            closed.countedCash ?? 0
          )} · ${varianceLabel(closed.variance)} ${signedMoney(closed.variance ?? 0)}${
            closed.handoverTo ? ` · handover to ${closed.handoverTo}` : ""
          }`,
          actor: actor.name,
          email: actor.email,
        });
      }
      toast({
        title: `${closed.id} closed`,
        description:
          Math.abs(closed.variance ?? 0) < 0.005
            ? `Balanced at ${money(closed.countedCash ?? 0)}. The till is ready for the next cashier.`
            : `${varianceLabel(closed.variance)} by ${signedMoney(closed.variance ?? 0)}. Recorded for review.`,
      });
      onClosed(closed);
      onOpenChange(false);
      if (signOutAfter) {
        try {
          const auth = getFirebaseAuth();
          if (auth) await signOut(auth);
        } catch {
          /* the local shift is already closed and safe */
        }
        clearStoredPortal();
        router.replace("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The shift could not be closed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-purple-600 dark:text-purple-400" aria-hidden="true" />
            Close shift & hand over
          </DialogTitle>
          <DialogDescription>
            Count all cash in the drawer, including the opening float. Pulse compares it with the
            shift&apos;s system total before closing the till.
          </DialogDescription>
        </DialogHeader>

        {shift && totals ? (
          <div className="grid gap-4">
            <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-slate-900 dark:text-white">{shift.id}</p>
                <p className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">
                  {shift.cashierName} · {shift.storeName}
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Float</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-slate-900 dark:text-white">{money(shift.openingFloat)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Cash sales</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-slate-900 dark:text-white">{money(totals.cashSales)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Cash refunds</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-slate-900 dark:text-white">{money(totals.cashRefunds)}</dd>
                </div>
                <div>
                  <dt className="text-purple-600 dark:text-purple-300">Expected in till</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-purple-700 dark:text-purple-300">{money(totals.expectedCash)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[11.5px] text-slate-400 dark:text-slate-500">
                {totals.transactionCount} sale{totals.transactionCount === 1 ? "" : "s"} · {totals.itemsSold} item
                {totals.itemsSold === 1 ? "" : "s"} · mobile {money(totals.mobileSales)} · card {money(totals.cardSales)}
              </p>
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="shift-counted-cash">Cash counted in the till (ZMW)</Label>
                <button
                  type="button"
                  onClick={() => setCounted(String(totals.expectedCash))}
                  className="text-[11.5px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
                >
                  Use expected {money(totals.expectedCash)}
                </button>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-slate-400">
                  K
                </span>
                <input
                  id="shift-counted-cash"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={counted}
                  onChange={(event) => {
                    setCounted(event.target.value);
                    setError("");
                  }}
                  placeholder="0.00"
                  className="h-11 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-[14px] font-bold tabular-nums outline-none transition-[border-color,box-shadow] placeholder:font-normal placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </div>
              <p className="text-[11.5px] leading-snug text-slate-400 dark:text-slate-500">
                Count every note and coin physically in the drawer. Do not include mobile money or card takings.
              </p>
            </div>

            {hasCount && (
              <div
                className={cn(
                  "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed",
                  Math.abs(variance) < 0.005
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200"
                    : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"
                )}
              >
                {Math.abs(variance) < 0.005 ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>
                  <span className="font-bold">{varianceLabel(variance)}</span>
                  {Math.abs(variance) < 0.005
                    ? " — the counted cash matches the system total."
                    : ` by ${signedMoney(variance)}. Add a note so the difference is explained at handover.`}
                </span>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="shift-handover">Hand over to (optional)</Label>
              <input
                id="shift-handover"
                type="text"
                value={handoverTo}
                onChange={(event) => setHandoverTo(event.target.value)}
                placeholder="Next cashier's name"
                maxLength={120}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[13.5px] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-purple-200 bg-purple-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-purple-900 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-200">
              <input
                type="checkbox"
                checked={signOutAfter}
                onChange={(event) => setSignOutAfter(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-purple-600"
              />
              <span>
                <span className="font-semibold">Sign this account out after closing.</span> The
                next cashier signs in with their own account and opens a fresh shift.
              </span>
            </label>

            <div className="grid gap-1.5">
              <Label htmlFor="shift-close-notes">
                Close-out note {needsNote ? "(required for the variance)" : "(optional)"}
              </Label>
              <Textarea
                id="shift-close-notes"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setError("");
                }}
                placeholder={
                  needsNote
                    ? "Explain the difference, e.g. change rounding, a refund paid from the drawer, or cash still with the supervisor."
                    : "Anything the next cashier should know about this till."
                }
                rows={3}
              />
            </div>

            {error && (
              <p role="alert" className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-slate-500 dark:text-slate-400">No open shift to close.</p>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || saving}
            className={cn(brandBtnCls, "h-10 px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40")}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}
            {saving ? "Closing…" : "Close shift"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

