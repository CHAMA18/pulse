"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileDown,
  FileSpreadsheet,
  PackageCheck,
  Receipt,
  Store,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { formatZMW } from "@/components/pharmacy/pharmacy-data";
import {
  listNetworkPharmacySales,
  type NetworkPharmacy,
  type NetworkPharmacySale,
} from "@/lib/cloud/pharmacy-sales";
import { buildSalesReportCsv } from "@/lib/sales-report-csv";
import { buildSalesReportPrintHtml } from "@/lib/sales-report-print";
import { loadCachedRead, saveCachedRead } from "@/lib/offline/read-cache";
import { cn } from "@/lib/utils";

type Period = "all" | "day" | "week" | "month" | "custom";

const PERIODS: { id: Period; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "day", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom range" },
];

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";

function dateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateInput(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function PageTitle({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
        <Icon className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-[21px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="text-[13.5px] text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tile,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tile: string;
}) {
  return (
    <div className={cn(cardCls, "flex min-w-0 items-center gap-4 p-5")}>
      <span className={cn("flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl", tile)}>
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="whitespace-nowrap text-2xl font-bold leading-none tracking-tight text-slate-900 dark:text-white">
          {value}
        </p>
        <p className="mt-2 text-[13px] font-semibold text-slate-600 dark:text-slate-300">{label}</p>
      </div>
    </div>
  );
}

export function PharmacySalesReport() {
  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sales, setSales] = useState<NetworkPharmacySale[]>([]);
  const [pharmacies, setPharmacies] = useState<NetworkPharmacy[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [error, setError] = useState("");
  const [pharmacyFilter, setPharmacyFilter] = useState("all");
  const activeRangeKey = useRef("");
  const busy = exporting || exportingCsv;

  const range = useMemo(() => {
    if (period === "all") return { start: undefined, end: undefined, error: "" };
    if (period === "custom") {
      const start = parseDateInput(customStart);
      const end = parseDateInput(customEnd);
      if (!start || !end) {
        return { start: undefined, end: undefined, error: "Choose both a start date and an end date." };
      }
      if (start.getTime() > end.getTime()) {
        return { start: undefined, end: undefined, error: "The start date must be on or before the end date." };
      }
      const endExclusive = new Date(end.getTime());
      endExclusive.setDate(endExclusive.getDate() + 1);
      return { start, end: endExclusive, error: "" };
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (period === "month") start.setDate(1);
    const end = new Date(start.getTime());
    if (period === "day") end.setDate(end.getDate() + 1);
    else if (period === "week") end.setDate(end.getDate() + 7);
    else end.setMonth(end.getMonth() + 1);
    return { start, end, error: "" };
  }, [period, customStart, customEnd]);

  const rangeKey = `${period}:${range.start?.getTime() ?? ""}:${range.end?.getTime() ?? ""}`;
  activeRangeKey.current = rangeKey;

  useEffect(() => {
    let active = true;
    activeRangeKey.current = rangeKey;
    setSales([]);
    setPharmacies([]);
    setCursor(null);
    setHasMore(false);
    setError("");
    setPharmacyFilter("all");
    if (range.error) {
      setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    void listNetworkPharmacySales({
      startAt: range.start?.getTime(),
      endAt: range.end?.getTime(),
    })
      .then((page) => {
        if (!active) return;
        setSales(page.sales);
        setPharmacies(page.pharmacies);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        saveCachedRead(`network-sales:${rangeKey}`, {
          sales: page.sales,
          pharmacies: page.pharmacies,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        });
      })
      .catch(() => {
        if (!active) return;
        // Offline: show the last successful read for this exact date range.
        const cached = loadCachedRead<{
          sales: NetworkPharmacySale[];
          pharmacies: NetworkPharmacy[];
          nextCursor: string | null;
          hasMore: boolean;
        }>(`network-sales:${rangeKey}`);
        if (cached) {
          setSales(cached.data.sales);
          setPharmacies(cached.data.pharmacies);
          setCursor(cached.data.nextCursor);
          setHasMore(cached.data.hasMore);
        } else {
          setError("Network sales could not be loaded. Check the connection and try again.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [range, rangeKey]);

  const loadOlderSales = async () => {
    if (!cursor || loadingMore) return;
    const requestedRange = rangeKey;
    setLoadingMore(true);
    try {
      const page = await listNetworkPharmacySales({
        startAt: range.start?.getTime(),
        endAt: range.end?.getTime(),
        cursor,
      });
      if (activeRangeKey.current !== requestedRange) return;
      setSales((current) => [...current, ...page.sales]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      if (activeRangeKey.current === requestedRange) {
        setError("Older sales could not be loaded. Try again.");
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const loadAllReportSales = async () => {
    const allSales: NetworkPharmacySale[] = [];
    let reportPharmacies: NetworkPharmacy[] = [];
    let nextCursor: string | undefined;
    let hasNextPage = true;

    while (hasNextPage) {
      const page = await listNetworkPharmacySales({
        startAt: range.start?.getTime(),
        endAt: range.end?.getTime(),
        cursor: nextCursor,
        limit: 200,
      });
      if (!nextCursor) reportPharmacies = page.pharmacies;
      allSales.push(...page.sales);
      nextCursor = page.nextCursor ?? undefined;
      hasNextPage = page.hasMore && Boolean(nextCursor);
      if (page.hasMore && !nextCursor) {
        throw new Error("The sales report could not load every page.");
      }
    }

    return { allSales, reportPharmacies };
  };

  const exportPdf = async () => {
    if (busy || loadingMore || range.error) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("Allow pop-ups for Pulse to export the branded PDF.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><title>Preparing Sales Report</title></head><body style="font:16px Arial,sans-serif;padding:32px;color:#27334a">Preparing your Pulse Sales Report PDF…</body></html>`);
    printWindow.document.close();
    setExporting(true);
    setError("");

    try {
      const { allSales, reportPharmacies } = await loadAllReportSales();

      const pharmacyDirectory = new Map(
        reportPharmacies.map((pharmacy) => [pharmacy.id, pharmacy] as const)
      );
      for (const sale of allSales) {
        if (!pharmacyDirectory.has(sale.pharmacyId)) {
          pharmacyDirectory.set(sale.pharmacyId, {
            id: sale.pharmacyId,
            name: sale.pharmacyName,
          });
        }
      }

      const selectedPharmacy = pharmacyFilter === "all"
        ? null
        : pharmacyDirectory.get(pharmacyFilter) ?? null;
      const scopedSales = selectedPharmacy
        ? allSales.filter((sale) => sale.pharmacyId === selectedPharmacy.id)
        : allSales;
      const scopedPharmacies = selectedPharmacy
        ? [selectedPharmacy]
        : Array.from(pharmacyDirectory.values());
      const rangeDate = (date: Date) => new Intl.DateTimeFormat("en-ZM", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
      const rangeLabel = period === "all"
        ? "All time"
        : range.start && range.end
          ? `${rangeDate(range.start)} - ${rangeDate(new Date(range.end.getTime() - 1))}`
          : "Selected period";

      printWindow.document.open();
      printWindow.document.write(buildSalesReportPrintHtml({
        sales: scopedSales,
        pharmacies: scopedPharmacies,
        rangeLabel,
        pharmacyScope: selectedPharmacy?.name ?? "All network pharmacies",
        generatedAt: Date.now(),
      }));
      printWindow.document.close();
      const fileDate = new Date().toISOString().slice(0, 10);
      printWindow.document.title = `Pulse-Sales-Report-${fileDate}`;
      window.setTimeout(() => {
        if (!printWindow.closed) {
          printWindow.focus();
          printWindow.print();
        }
      }, 250);
    } catch {
      printWindow.close();
      setError("The PDF export failed while loading sales. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const exportCsv = async () => {
    if (busy || loadingMore || range.error) return;
    setExportingCsv(true);
    setError("");

    try {
      const { allSales } = await loadAllReportSales();
      const scopedSales =
        pharmacyFilter === "all"
          ? allSales
          : allSales.filter((sale) => sale.pharmacyId === pharmacyFilter);
      const blob = new Blob([`\uFEFF${buildSalesReportCsv(scopedSales)}`], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Pulse-Sales-Report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("The CSV export failed while loading sales. Please try again.");
    } finally {
      setExportingCsv(false);
    }
  };

  const completedSales = sales.filter((sale) => !sale.reversedAt);
  const totalUnits = completedSales.reduce(
    (sum, sale) => sum + sale.lines.reduce((lineSum, line) => lineSum + line.qty, 0),
    0
  );
  const totalRevenue = completedSales.reduce((sum, sale) => sum + sale.total, 0);
  const pharmacyNames = Array.from(
    new Map([
      ...pharmacies.map((pharmacy) => [pharmacy.id, pharmacy.name] as const),
      ...sales.map((sale) => [sale.pharmacyId, sale.pharmacyName] as const),
    ]).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const groupedPharmacies = Array.from(
    sales.reduce((groups, sale) => {
      const current = groups.get(sale.pharmacyId) ?? {
        id: sale.pharmacyId,
        name: sale.pharmacyName,
        transactions: 0,
        reversed: 0,
        units: 0,
        revenue: 0,
        lastSaleAt: undefined as number | undefined,
      };
      current.transactions += 1;
      current.lastSaleAt = Math.max(current.lastSaleAt ?? sale.soldAt, sale.soldAt);
      if (sale.reversedAt) current.reversed += 1;
      else {
        current.units += sale.lines.reduce((sum, line) => sum + line.qty, 0);
        current.revenue += sale.total;
      }
      groups.set(sale.pharmacyId, current);
      return groups;
    }, new Map<string, {
      id: string;
      name: string;
      transactions: number;
      reversed: number;
      units: number;
      revenue: number;
      lastSaleAt: number | undefined;
    }>()),
  ).map(([, value]) => value);
  for (const [id, name] of pharmacyNames) {
    // Match on id, then on name: a registered pharmacy must appear exactly
    // once even if its directory id and sales id were resolved differently.
    if (
      !groupedPharmacies.some(
        (pharmacy) => pharmacy.id === id || pharmacy.name.trim().toLowerCase() === name.trim().toLowerCase()
      )
    ) {
      groupedPharmacies.push({
        id,
        name,
        transactions: 0,
        reversed: 0,
        units: 0,
        revenue: 0,
        lastSaleAt: undefined,
      });
    }
  }
  groupedPharmacies.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

  const choosePeriod = (next: Period) => {
    setPeriod(next);
    if (next === "custom") {
      const now = new Date();
      if (!customStart) setCustomStart(dateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)));
      if (!customEnd) setCustomEnd(dateInputValue(now));
    }
  };

  return (
    <div className="space-y-7" data-tour="pulse-sales">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageTitle
          icon={Receipt}
          title="Sales Report"
          subtitle="All POS sales across the Pulse network, by pharmacy, store, payment method and product."
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={loading || loadingMore || busy || Boolean(range.error)}
            aria-label="Export Sales Report as CSV"
            title="Downloads every sale line in this date range as a CSV spreadsheet."
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-[12.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {exportingCsv ? "Preparing CSV…" : "Export CSV"}
          </button>
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={loading || loadingMore || busy || Boolean(range.error)}
            aria-label="Export Sales Report as PDF"
            title="Opens a print dialog where you can save the branded report as a PDF."
            className="btn-brand inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-[12.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(168,85,247,0.65)] transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            {exporting ? "Preparing PDF…" : "Export PDF"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sales date range">
        {PERIODS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={period === id}
            disabled={busy}
            onClick={() => choosePeriod(id)}
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
        <label className="ml-auto inline-flex items-center gap-2 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
          <span className="whitespace-nowrap">Pharmacy</span>
          <select
            aria-label="Filter sales report by pharmacy"
            value={pharmacyFilter}
            disabled={busy}
            onChange={(event) => setPharmacyFilter(event.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-[12.5px] font-normal text-slate-700 outline-none focus:border-purple-400 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
          >
            <option value="all">All pharmacies</option>
            {pharmacyNames.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {period === "custom" && (
        <div className="grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-[12px] font-semibold text-slate-600 dark:text-slate-300" htmlFor="network-sales-start">
            Start date
            <input
              id="network-sales-start"
              type="date"
              disabled={busy}
              value={customStart}
              max={customEnd || undefined}
              onChange={(event) => setCustomStart(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-normal text-slate-700 outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
            />
          </label>
          <label className="grid gap-1.5 text-[12px] font-semibold text-slate-600 dark:text-slate-300" htmlFor="network-sales-end">
            End date
            <input
              id="network-sales-end"
              type="date"
              disabled={busy}
              value={customEnd}
              min={customStart || undefined}
              onChange={(event) => setCustomEnd(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-normal text-slate-700 outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
            />
          </label>
        </div>
      )}

      {range.error ? (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          {range.error}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Store} label="Network pharmacies" value={loading ? "—" : String(pharmacyNames.length)} tile="bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400" />
        <StatCard icon={Receipt} label="POS transactions loaded" value={loading ? "—" : String(sales.length)} tile="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400" />
        <StatCard icon={PackageCheck} label="Units sold" value={loading ? "—" : String(totalUnits)} tile="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400" />
        <StatCard icon={TrendingUp} label="Net sales value" value={loading ? "—" : formatZMW(totalRevenue)} tile="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400" />
      </div>

      <section aria-labelledby="sales-by-pharmacy-title">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
            <Store className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id="sales-by-pharmacy-title" className="text-[18px] font-bold tracking-tight text-slate-900 dark:text-white">Sales by pharmacy</h3>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Totals cover loaded transactions. Load older sales to extend them; revenue excludes reversed transactions.</p>
          </div>
        </div>
        <div className={cn(cardCls, "overflow-hidden")}>
          {loading ? (
            <p className="px-5 py-7 text-center text-[13px] text-slate-500 dark:text-slate-400">Loading pharmacy sales…</p>
          ) : groupedPharmacies.length === 0 ? (
            <p className="px-5 py-7 text-center text-[13px] text-slate-500 dark:text-slate-400">
              No POS sales have synced for this date range yet. Sales sync from each pharmacy when its POS reconnects.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[12.5px]">
                <thead className="bg-slate-50 text-[10.5px] uppercase tracking-[0.12em] text-slate-400 dark:bg-white/[0.035] dark:text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Pharmacy</th>
                    <th className="px-4 py-3 font-semibold">Transactions</th>
                    <th className="px-4 py-3 font-semibold">Items sold</th>
                    <th className="px-4 py-3 font-semibold">Net sales</th>
                    <th className="px-4 py-3 font-semibold">Reversed</th>
                    <th className="px-4 py-3 font-semibold">Last sale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {groupedPharmacies.map((pharmacy) => (
                    <tr key={pharmacy.id}>
                      <td className="px-4 py-3.5 font-semibold text-slate-900 dark:text-white">{pharmacy.name}</td>
                      <td className="px-4 py-3.5 tabular-nums text-slate-600 dark:text-slate-300">{pharmacy.transactions}</td>
                      <td className="px-4 py-3.5 tabular-nums text-slate-600 dark:text-slate-300">{pharmacy.units}</td>
                      <td className="px-4 py-3.5 font-bold tabular-nums text-slate-900 dark:text-white">{formatZMW(pharmacy.revenue)}</td>
                      <td className="px-4 py-3.5 tabular-nums text-slate-600 dark:text-slate-300">{pharmacy.reversed}</td>
                      <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400">{pharmacy.lastSaleAt ? formatDateTime(pharmacy.lastSaleAt) : "No sales"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMore && (
                <div className="border-t border-slate-100 p-3 text-center dark:border-white/5">
                  <button
                    type="button"
                    onClick={loadOlderSales}
                    disabled={loadingMore}
                    className="rounded-md px-4 py-2 text-[12.5px] font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-50 dark:text-purple-300 dark:hover:bg-white/5"
                  >
                    {loadingMore ? "Loading…" : "Load older sales"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
