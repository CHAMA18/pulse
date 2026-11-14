"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock,
  History,
  LockKeyhole,
  Receipt,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadSales,
  mainStoreOf,
  type PharmacyStore,
  type POSSale,
} from "@/components/pharmacy/pharmacy-data";
import {
  PageHeader,
  pharmacyCardCls,
} from "@/components/pharmacy/pharmacy-shared";
import {
  CloseShiftDialog,
  OpenShiftDialog,
} from "@/components/pharmacy/shift-dialogs";
import {
  SHIFTS_EVENT,
  activeShiftForEmail,
  activeShiftForStore,
  formatShiftZMW,
  loadShifts,
  shiftDuration,
  shiftTotals,
  varianceLabel,
  type PharmacyShift,
  type ShiftActor,
} from "@/lib/pharmacy-shifts";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Shift Management                                                    */
/* ------------------------------------------------------------------ */

const item = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function money(value: number): string {
  return formatShiftZMW(value);
}

function signedMoney(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${money(Math.abs(value))}`;
}

function dateTime(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ShiftPill({ status }: { status: "open" | "closed" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
        status === "open"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "open" ? "bg-emerald-500" : "bg-slate-400"
        )}
      />
      {status === "open" ? "Open" : "Closed"}
    </span>
  );
}

function VariancePill({ variance }: { variance: number | undefined }) {
  const label = varianceLabel(variance);
  const balanced = label === "Balanced";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold",
        balanced
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"
      )}
    >
      {label}
      {!balanced && ` · ${signedMoney(variance ?? 0)}`}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tile,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint: string;
  tile: string;
}) {
  return (
    <motion.div variants={item} className={cn(pharmacyCardCls, "flex items-center gap-4 p-5")}>
      <span className={cn("flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl", tile)}>
        <Icon className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="whitespace-nowrap text-[24px] font-bold leading-none tracking-tight tabular-nums">
          {value}
        </p>
        <p className="mt-1.5 text-[14px] font-semibold leading-none">{label}</p>
        <p className="mt-1.5 truncate text-[12px] text-slate-500 dark:text-slate-400">{hint}</p>
      </div>
    </motion.div>
  );
}

export function PharmacyShifts({
  storeId,
  stores,
  user,
  onGoToPos,
}: {
  storeId: string;
  stores: PharmacyStore[];
  user: ShiftActor;
  onGoToPos: () => void;
}) {
  const [shifts, setShifts] = useState<PharmacyShift[]>([]);
  const [sales, setSales] = useState<POSSale[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);

  const reload = useCallback(() => {
    setShifts(loadShifts());
    setSales(loadSales());
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      reload();
      setHydrated(true);
    });
    const onChange = () => reload();
    window.addEventListener(SHIFTS_EVENT, onChange);
    window.addEventListener("pulse:pharmacy-change", onChange);
    window.addEventListener("storage", onChange);
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener(SHIFTS_EVENT, onChange);
      window.removeEventListener("pulse:pharmacy-change", onChange);
      window.removeEventListener("storage", onChange);
      window.clearInterval(timer);
    };
  }, [reload]);

  const activeStore = useMemo(() => {
    if (storeId === "all") return mainStoreOf(stores);
    return stores.find((store) => store.id === storeId) ?? mainStoreOf(stores);
  }, [storeId, stores]);

  const storeShifts = useMemo(
    () =>
      shifts.filter((shift) => !activeStore || shift.storeId === activeStore.id),
    [shifts, activeStore]
  );

  const myShift = useMemo(
    () =>
      activeStore
        ? activeShiftForStore(user.email, activeStore.id, shifts)
        : undefined,
    [activeStore, shifts, user.email]
  );
  const myShiftElsewhere = useMemo(
    () => activeShiftForEmail(user.email, shifts),
    [shifts, user.email]
  );

  const otherOpenShift = useMemo(
    () =>
      activeStore
        ? storeShifts.find(
            (shift) =>
              shift.status === "open" &&
              shift.id !== myShift?.id &&
              shift.cashierEmail.toLowerCase() !== user.email.toLowerCase()
          )
        : undefined,
    [activeStore, storeShifts, myShift?.id, user.email]
  );

  const currentTotals = myShift ? shiftTotals(myShift, sales) : null;

  const startOfToday = useMemo(() => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }, [now]);

  const todayShifts = storeShifts.filter((shift) => shift.openedAt >= startOfToday);
  const todayClosed = todayShifts.filter((shift) => shift.status === "closed");
  const todayVariance = todayClosed.reduce(
    (sum, shift) => sum + Math.abs(shift.variance ?? 0),
    0
  );

  const canOpen =
    Boolean(activeStore) &&
    Boolean(user.email) &&
    !myShift &&
    !myShiftElsewhere &&
    !otherOpenShift;

  return (
    <div aria-labelledby="pharmacy-shifts-title">
      <PageHeader
        icon={Wallet}
        title="Shift Management"
        subtitle="Open the till, balance cash at hand against the system, and hand over a clean account"
        tourId="ph-shifts"
        actions={
          myShift ? (
            <button
              type="button"
              onClick={() => setCloseDialog(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(147,51,234,0.65)] transition-shadow hover:shadow-[0_12px_28px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
            >
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              Close & hand over
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpenDialog(true)}
              disabled={!canOpen}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(147,51,234,0.65)] transition-shadow hover:shadow-[0_12px_28px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Banknote className="h-4 w-4" aria-hidden="true" />
              Open shift
            </button>
          )
        }
      />
      <h2 id="pharmacy-shifts-title" className="sr-only">
        Shift Management
      </h2>

      {!activeStore && hydrated && (
        <div className="mt-5 flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          Add a store under Stores before opening a till shift.
        </div>
      )}

      {myShiftElsewhere && !myShift && (
        <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Your shift <span className="font-bold">{myShiftElsewhere.id}</span> is still open at{" "}
            <span className="font-semibold">{myShiftElsewhere.storeName}</span>. Close it before
            opening a shift at {activeStore?.name ?? "another store"}.
          </p>
        </div>
      )}

      {otherOpenShift && (
        <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-bold">{otherOpenShift.id}</span> is open for{" "}
            <span className="font-semibold">{otherOpenShift.cashierName}</span> at this store. Only
            that cashier can close their own till.
          </p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="Current shift"
          value={myShift ? "Open" : "Closed"}
          hint={myShift ? `${myShift.id} · ${shiftDuration(myShift)}` : "Open a shift to trade"}
          tile={
            myShift
              ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
              : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300"
          }
        />
        <StatCard
          icon={Banknote}
          label="Expected in till"
          value={currentTotals ? money(currentTotals.expectedCash) : "—"}
          hint={myShift ? `Float ${money(myShift.openingFloat)}` : "No open till"}
          tile="bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
        />
        <StatCard
          icon={Receipt}
          label="Shift cash sales"
          value={currentTotals ? money(currentTotals.cashSales) : "—"}
          hint={currentTotals ? `${currentTotals.transactionCount} sale${currentTotals.transactionCount === 1 ? "" : "s"}` : "Start a shift to track"}
          tile="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"
        />
        <StatCard
          icon={History}
          label="Closed today"
          value={String(todayClosed.length)}
          hint={todayClosed.length > 0 ? `${money(todayVariance)} total variance` : `${todayShifts.length} shift${todayShifts.length === 1 ? "" : "s"} today`}
          tile="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
        />
      </div>

      {/* Current till */}
      <motion.section variants={item} className="mt-7" aria-labelledby="current-shift-title">
        <div className={cn(pharmacyCardCls, "overflow-hidden")}>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
              <Clock className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 id="current-shift-title" className="text-[16px] font-bold tracking-tight text-slate-900 dark:text-white">
                Current till
              </h3>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
                {activeStore ? `${activeStore.name} · ${user.name || "Cashier"}` : "No store selected"}
              </p>
            </div>
            {myShift ? <ShiftPill status="open" /> : <ShiftPill status="closed" />}
          </div>

          {myShift && currentTotals ? (
            <div className="p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Shift</p>
                  <p className="mt-1 text-[16px] font-bold tabular-nums text-slate-900 dark:text-white">{myShift.id}</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">Opened {dateTime(myShift.openedAt)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Opening float</p>
                  <p className="mt-1 text-[16px] font-bold tabular-nums text-slate-900 dark:text-white">{money(myShift.openingFloat)}</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">Duration {shiftDuration(myShift)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Cash in</p>
                  <p className="mt-1 text-[16px] font-bold tabular-nums text-slate-900 dark:text-white">{money(currentTotals.cashSales)}</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">Refunds {money(currentTotals.cashRefunds)}</p>
                </div>
                <div className="rounded-xl bg-purple-50 px-4 py-3 dark:bg-purple-500/10">
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-purple-600 dark:text-purple-300">Expected in till</p>
                  <p className="mt-1 text-[20px] font-bold tabular-nums text-purple-700 dark:text-purple-200">{money(currentTotals.expectedCash)}</p>
                  <p className="mt-0.5 text-[11.5px] text-purple-600/80 dark:text-purple-300/80">
                    {currentTotals.transactionCount} sale{currentTotals.transactionCount === 1 ? "" : "s"} · {currentTotals.itemsSold} item{currentTotals.itemsSold === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setCloseDialog(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(147,51,234,0.65)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
                >
                  <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                  Close & hand over
                </button>
                <button
                  type="button"
                  onClick={onGoToPos}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-purple-200 bg-white px-4 text-[13px] font-semibold text-purple-700 transition-colors hover:bg-purple-50 dark:border-purple-500/25 dark:bg-transparent dark:text-purple-300 dark:hover:bg-purple-500/10"
                >
                  Go to Point of Sale
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <p className="text-[11.5px] text-slate-400 dark:text-slate-500">
                  Mobile {money(currentTotals.mobileSales)} · Card {money(currentTotals.cardSales)}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100">
                  {canOpen ? "No shift open for you at this store." : "This till is not open for you."}
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {canOpen
                    ? "Count the opening float, open the shift, then the POS will let you charge customers."
                    : myShiftElsewhere
                      ? "Close your existing shift before opening another till."
                      : otherOpenShift
                        ? "The current cashier must close their shift before a new one can start."
                        : "Add a store before opening a shift."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenDialog(true)}
                disabled={!canOpen}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(147,51,234,0.65)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Banknote className="h-4 w-4" aria-hidden="true" />
                Open shift
              </button>
            </div>
          )}
        </div>
      </motion.section>

      {/* How close-out works */}
      <motion.section variants={item} className="mt-6" aria-labelledby="shift-close-steps">
        <div className={cn(pharmacyCardCls, "p-5 sm:p-6")}>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <CheckCircle2 className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <h3 id="shift-close-steps" className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
                How a clean handover works
              </h3>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
                The till is never handed over on trust alone.
              </p>
            </div>
          </div>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Count the cash",
                body: "At close, count every note and coin in the drawer — including the opening float.",
              },
              {
                step: "2",
                title: "Balance against the system",
                body: "Pulse compares counted cash with float + cash sales − refunds and records any variance.",
              },
              {
                step: "3",
                title: "Close and hand over",
                body: "The shift closes with a signed amount and note; the next cashier opens a fresh shift.",
              },
            ].map((entry) => (
              <li key={entry.step} className="flex gap-3 rounded-xl bg-slate-50 px-4 py-3.5 dark:bg-white/5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[12px] font-bold text-white">
                  {entry.step}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-slate-900 dark:text-white">{entry.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{entry.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </motion.section>

      {/* History */}
      <motion.section variants={item} className="mt-7" aria-labelledby="shift-history-title">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
            <History className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id="shift-history-title" className="text-[17px] font-bold tracking-tight text-slate-900 dark:text-white">
              Shift history
            </h3>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
              Every open and close at {activeStore?.name ?? "this pharmacy"}.
            </p>
          </div>
          <span className="ml-auto text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">
            {storeShifts.length} shift{storeShifts.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className={cn(pharmacyCardCls, "overflow-hidden")}>
          {!hydrated ? (
            <p className="px-5 py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
              Loading shift history…
            </p>
          ) : storeShifts.length === 0 ? (
            <div className="flex min-h-[170px] flex-col items-center justify-center gap-2.5 px-6 py-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5">
                <Wallet className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="text-[14px] font-semibold text-slate-800 dark:text-white">No shifts yet</p>
              <p className="max-w-sm text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                Open a shift with the starting cash in the drawer. When it closes, the counted and
                expected totals stay here for handover.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                      <th scope="col" className="py-3.5 pl-5 pr-3 font-medium">Shift</th>
                      <th scope="col" className="px-3 py-3.5 font-medium">Cashier</th>
                      <th scope="col" className="px-3 py-3.5 font-medium">Window</th>
                      <th scope="col" className="px-3 py-3.5 font-medium">Float</th>
                      <th scope="col" className="px-3 py-3.5 font-medium">Expected</th>
                      <th scope="col" className="px-3 py-3.5 font-medium">Counted</th>
                      <th scope="col" className="px-3 py-3.5 font-medium">Variance</th>
                      <th scope="col" className="py-3.5 pl-3 pr-5 font-medium">Handover</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {storeShifts.map((shift) => (
                      <tr key={shift.id} className="align-top transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.03]">
                        <td className="py-3.5 pl-5 pr-3">
                          <p className="whitespace-nowrap text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">{shift.id}</p>
                          <div className="mt-1"><ShiftPill status={shift.status} /></div>
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{shift.cashierName}</p>
                          <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">{shift.storeName}</p>
                        </td>
                        <td className="px-3 py-3.5 text-[12px] text-slate-500 dark:text-slate-400">
                          <p>{dateTime(shift.openedAt)}</p>
                          <p className="mt-0.5">{shift.closedAt ? dateTime(shift.closedAt) : "Still open"}</p>
                          <p className="mt-0.5 text-[11px]">{shiftDuration(shift)}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-[12.5px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{money(shift.openingFloat)}</td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-[12.5px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                          {shift.expectedCash === undefined ? "—" : money(shift.expectedCash)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-[12.5px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                          {shift.countedCash === undefined ? "—" : money(shift.countedCash)}
                        </td>
                        <td className="px-3 py-3.5">
                          {shift.status === "closed" ? <VariancePill variance={shift.variance} /> : <span className="text-[12px] text-slate-400">Pending</span>}
                        </td>
                        <td className="max-w-[190px] px-3 py-3.5 text-[12px] text-slate-500 dark:text-slate-400">
                          <p className="truncate">{shift.handoverTo || "—"}</p>
                          {shift.closingNotes && <p className="mt-0.5 line-clamp-2 text-[11.5px]">{shift.closingNotes}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-slate-100 md:hidden dark:divide-white/5">
                {storeShifts.map((shift) => (
                  <li key={shift.id} className="p-4">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-bold tabular-nums text-slate-900 dark:text-white">{shift.id}</p>
                        <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{shift.cashierName} · {shift.storeName}</p>
                      </div>
                      <ShiftPill status={shift.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Float</p>
                        <p className="mt-0.5 font-semibold tabular-nums">{money(shift.openingFloat)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Expected</p>
                        <p className="mt-0.5 font-semibold tabular-nums">{shift.expectedCash === undefined ? "—" : money(shift.expectedCash)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Counted</p>
                        <p className="mt-0.5 font-semibold tabular-nums">{shift.countedCash === undefined ? "—" : money(shift.countedCash)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {shift.status === "closed" ? <VariancePill variance={shift.variance} /> : null}
                      <span className="text-[11.5px] text-slate-500 dark:text-slate-400">{dateTime(shift.openedAt)} · {shiftDuration(shift)}</span>
                    </div>
                    {shift.handoverTo && (
                      <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">Handed over to {shift.handoverTo}</p>
                    )}
                    {shift.closingNotes && (
                      <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{shift.closingNotes}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </motion.section>

      <OpenShiftDialog
        open={openDialog}
        onOpenChange={setOpenDialog}
        actor={user}
        store={activeStore ? { id: activeStore.id, name: activeStore.name } : undefined}
        onOpened={() => reload()}
      />
      <CloseShiftDialog
        open={closeDialog}
        onOpenChange={setCloseDialog}
        shift={myShift ?? null}
        sales={sales}
        actor={user}
        onClosed={() => reload()}
      />
    </div>
  );
}
