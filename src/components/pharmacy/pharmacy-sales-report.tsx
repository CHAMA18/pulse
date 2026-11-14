"use client";

import { FileDown, Receipt } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatZMW,
  loadSales,
  resolveStoreId,
  type PharmacyStore,
  type POSSale,
  type POSPaymentMethod,
} from "@/components/pharmacy/pharmacy-data";
import { PageHeader, pharmacyCardCls } from "@/components/pharmacy/pharmacy-shared";
import { buildPharmacySalesReportHtml } from "@/lib/pharmacy-sales-report-print";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type SalesReportPeriod = "day" | "week" | "month" | "custom";

const PERIODS: { id: SalesReportPeriod; label: string }[] = [
  { id: "day", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom range" },
];

const PAYMENT_METHODS: { id: POSPaymentMethod; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "mobile", label: "Mobile money" },
  { id: "card", label: "Card" },
];

function localDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateInput(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function PharmacySalesReport({
  storeId = "all",
  stores,
  pharmacyName = "Pulse Pharmacy",
  preparedBy,
}: {
  storeId?: string;
  stores: PharmacyStore[];
  /** Printed on the branded PDF as the pharmacy of record. */
  pharmacyName?: string;
  /** The signed-in user credited on the PDF as its preparer. */
  preparedBy?: string;
}) {
  const [sales, setSales] = useState<POSSale[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [period, setPeriod] = useState<SalesReportPeriod>("day");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setSales(loadSales());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const scopeAll = storeId === "all";
  const selectedStoreName = stores.find((store) => store.id === storeId)?.name;
  const storeName = scopeAll ? "all stores" : selectedStoreName ?? "this store";
  const scopeLabel = scopeAll ? "All stores" : selectedStoreName ?? "This store";

  const selectPeriod = (nextPeriod: SalesReportPeriod) => {
    setPeriod(nextPeriod);
    if (nextPeriod === "custom") {
      const now = new Date();
      if (!customStartDate) setCustomStartDate(localDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
      if (!customEndDate) setCustomEndDate(localDateInput(now));
    }
  };

  const reportRange = useMemo(() => {
    if (period === "custom") {
      const start = parseLocalDateInput(customStartDate);
      const end = parseLocalDateInput(customEndDate);
      if (!start || !end) {
        return { start: null, endExclusive: null, error: "Choose both a start date and an end date." };
      }
      if (start.getTime() > end.getTime()) {
        return { start: null, endExclusive: null, error: "The start date must be on or before the end date." };
      }
      const endExclusive = new Date(end.getTime());
      endExclusive.setDate(endExclusive.getDate() + 1);
      return { start, endExclusive, error: "" };
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === "week") {
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    } else if (period === "month") {
      start.setDate(1);
    }
    const endExclusive = new Date(start.getTime());
    if (period === "day") endExclusive.setDate(endExclusive.getDate() + 1);
    else if (period === "week") endExclusive.setDate(endExclusive.getDate() + 7);
    else endExclusive.setMonth(endExclusive.getMonth() + 1);
    return { start, endExclusive, error: "" };
  }, [period, customStartDate, customEndDate]);

  const reportSales = useMemo(() => {
    const startAt = reportRange.start?.getTime();
    const endAt = reportRange.endExclusive?.getTime();
    if (startAt === undefined || endAt === undefined) return [];
    return sales.filter(
      (sale) =>
        !sale.reversedAt &&
        sale.soldAt >= startAt &&
        sale.soldAt < endAt &&
        (scopeAll || resolveStoreId(sale) === storeId)
    );
  }, [sales, reportRange, scopeAll, storeId]);

  const summary = useMemo(() => {
    const revenue = reportSales.reduce((sum, sale) => sum + sale.total, 0);
    const units = reportSales.reduce(
      (sum, sale) => sum + sale.lines.reduce((lineSum, line) => lineSum + line.qty, 0),
      0
    );
    return {
      sales: reportSales.length,
      units,
      revenue,
      average: reportSales.length > 0 ? revenue / reportSales.length : 0,
      byMethod: PAYMENT_METHODS.map(({ id, label }) => ({
        id,
        label,
        amount: reportSales
          .filter((sale) => sale.method === id)
          .reduce((sum, sale) => sum + sale.total, 0),
      })),
    };
  }, [reportSales]);

  const rangeLabel = useMemo(() => {
    if (!reportRange.start || !reportRange.endExclusive) return "";
    const lastDay = new Date(reportRange.endExclusive.getTime());
    lastDay.setDate(lastDay.getDate() - 1);
    const formatter = new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${formatter.format(reportRange.start)} – ${formatter.format(lastDay)}`;
  }, [reportRange]);

  /** Opens the branded report in a print-ready window so it can be saved as a PDF. */
  const exportPdf = () => {
    if (!hydrated || exporting || reportRange.error) return;
    const start = reportRange.start;
    const endExclusive = reportRange.endExclusive;
    if (!start || !endExclusive) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setExportError("Allow pop-ups for Pulse to export the branded PDF.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(
      '<!doctype html><html><head><title>Preparing Sales Report</title></head><body style="margin:0;display:grid;min-height:100vh;place-items:center;background:#f7f2fb;color:#4c2a6b;font:14px Arial,sans-serif">Preparing your branded Pulse Sales Report…</body></html>'
    );
    printWindow.document.close();
    setExporting(true);
    setExportError("");

    window.setTimeout(() => {
      try {
        printWindow.document.open();
        printWindow.document.write(
          buildPharmacySalesReportHtml({
            sales: reportSales,
            pharmacyName,
            storeScope: scopeLabel,
            scopeAllStores: scopeAll,
            periodLabel: PERIODS.find((entry) => entry.id === period)?.label ?? "Selected period",
            rangeLabel,
            startAt: start.getTime(),
            endExclusive: endExclusive.getTime(),
            generatedAt: Date.now(),
            preparedBy,
          })
        );
        printWindow.document.close();
        window.setTimeout(() => {
          if (printWindow.closed) return;
          printWindow.focus();
          printWindow.print();
        }, 220);
      } catch {
        printWindow.close();
        setExportError("The branded PDF could not be prepared. Please try again.");
      } finally {
        setExporting(false);
      }
    }, 80);
  };

  return (
    <div>
      <PageHeader
        icon={Receipt}
        title="Sales Report"
        subtitle={`Completed sales for ${storeName}; reversed sales are excluded.`}
        actions={
          <button
            type="button"
            onClick={exportPdf}
            disabled={!hydrated || exporting || Boolean(reportRange.error)}
            aria-label="Export Sales Report as a branded PDF"
            title="Opens a print dialog where you can save the branded report as a PDF."
            className="btn-brand inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-[12.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(168,85,247,0.65)] transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            {exporting ? "Preparing PDF…" : "Export PDF"}
          </button>
        }
      />

      {exportError && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"
        >
          {exportError}
        </p>
      )}

      <section className={cn(pharmacyCardCls, "mt-5 p-4 sm:p-5")} aria-label="Sales summary">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sales report date range">
          {PERIODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={period === id}
              onClick={() => selectPeriod(id)}
              className={cn(
                "inline-flex h-9 items-center rounded-full px-4 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                period === id
                  ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:max-w-lg sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sales-report-start">Start date</Label>
              <input
                id="sales-report-start"
                type="date"
                value={customStartDate}
                max={customEndDate || undefined}
                onChange={(event) => setCustomStartDate(event.target.value)}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sales-report-end">End date</Label>
              <input
                id="sales-report-end"
                type="date"
                value={customEndDate}
                min={customStartDate || undefined}
                onChange={(event) => setCustomEndDate(event.target.value)}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
              />
            </div>
          </div>
        )}

        {reportRange.error ? (
          <p role="alert" className="mt-4 rounded-lg bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            {reportRange.error}
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-500 dark:text-slate-400">
              <span>{rangeLabel}</span>
              <span>{hydrated ? summary.sales : "—"} completed transaction{summary.sales === 1 ? "" : "s"}</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                { label: "Completed sales", value: hydrated ? String(summary.sales) : "—" },
                { label: "Items sold", value: hydrated ? String(summary.units) : "—" },
                { label: "Revenue", value: hydrated ? formatZMW(summary.revenue) : "—" },
                { label: "Average sale", value: hydrated ? formatZMW(summary.average) : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
                  <p className="text-[18px] font-bold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">
                    {value}
                  </p>
                  <p className="mt-1.5 text-[11.5px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-3 dark:border-white/5">
              <p className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">Revenue by payment method</p>
              {summary.byMethod.map(({ id, label, amount }) => (
                <p key={id} className="text-[12px] text-slate-600 dark:text-slate-300">
                  {label}: <span className="font-bold tabular-nums">{hydrated ? formatZMW(amount) : "—"}</span>
                </p>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
