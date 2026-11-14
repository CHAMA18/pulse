"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Receipt,
  Search,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatZMW } from "@/components/pharmacy/pharmacy-data";
import {
  listNetworkPharmacySales,
  type NetworkPharmacy,
  type NetworkPharmacySale,
} from "@/lib/cloud/pharmacy-sales";
import { loadCachedRead, saveCachedRead } from "@/lib/offline/read-cache";
import { cn } from "@/lib/utils";

const CACHE_KEY = "network-sales:all::";

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function reportStoreName(sale: NetworkPharmacySale): string {
  return sale.storeName || sale.storeId || "Main store";
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

export function PharmacyPosTransactions() {
  const [sales, setSales] = useState<NetworkPharmacySale[]>([]);
  const [pharmacies, setPharmacies] = useState<NetworkPharmacy[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [pharmacyFilter, setPharmacyFilter] = useState("all");
  const [selectedSale, setSelectedSale] = useState<NetworkPharmacySale | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    void listNetworkPharmacySales({})
      .then((page) => {
        if (!active) return;
        setSales(page.sales);
        setPharmacies(page.pharmacies);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        saveCachedRead(CACHE_KEY, {
          sales: page.sales,
          pharmacies: page.pharmacies,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        });
      })
      .catch(() => {
        if (!active) return;
        const cached = loadCachedRead<{
          sales: NetworkPharmacySale[];
          pharmacies: NetworkPharmacy[];
          nextCursor: string | null;
          hasMore: boolean;
        }>(CACHE_KEY);
        if (cached) {
          setSales(cached.data.sales);
          setPharmacies(cached.data.pharmacies);
          setCursor(cached.data.nextCursor);
          setHasMore(cached.data.hasMore);
        } else {
          setError("POS transactions could not be loaded. Check the connection and try again.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const loadOlderSales = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listNetworkPharmacySales({ cursor });
      setSales((current) => [...current, ...page.sales]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      setError("Older sales could not be loaded. Try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const pharmacyNames = useMemo(
    () =>
      Array.from(
        new Map([
          ...pharmacies.map((pharmacy) => [pharmacy.id, pharmacy.name] as const),
          ...sales.map((sale) => [sale.pharmacyId, sale.pharmacyName] as const),
        ]).entries()
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [pharmacies, sales]
  );

  const filteredSales = useMemo(
    () =>
      sales
        .filter((sale) => pharmacyFilter === "all" || sale.pharmacyId === pharmacyFilter)
        .filter((sale) => {
          const query = search.trim().toLowerCase();
          if (!query) return true;
          return (
            sale.pharmacyName.toLowerCase().includes(query) ||
            reportStoreName(sale).toLowerCase().includes(query) ||
            sale.id.toLowerCase().includes(query) ||
            sale.servedBy.toLowerCase().includes(query) ||
            sale.lines.some((line) => line.name.toLowerCase().includes(query))
          );
        })
        .sort((a, b) => b.soldAt - a.soldAt),
    [sales, pharmacyFilter, search]
  );

  return (
    <div className="space-y-7" data-tour="pulse-transactions">
      <PageTitle
        icon={Receipt}
        title="POS Transactions"
        subtitle="Product lines, quantity, unit price, cashier, payment and reversal details."
      />

      <section aria-labelledby="network-sales-detail-title">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3
            id="network-sales-detail-title"
            className="text-[18px] font-bold tracking-tight text-slate-900 dark:text-white"
          >
            Every sale, line by line
          </h3>
          <div className="ml-auto flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <label className="relative min-w-0 flex-1 sm:w-[280px]" aria-label="Search transactions">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pharmacy, item, cashier or sale ID…"
                className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-[12.5px] outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </label>
            <select
              aria-label="Filter by pharmacy"
              value={pharmacyFilter}
              disabled={loading}
              onChange={(event) => setPharmacyFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-[12.5px] text-slate-700 outline-none focus:border-purple-400 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
            >
              <option value="all">All pharmacies</option>
              {pharmacyNames.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"
          >
            {error}
          </p>
        ) : null}


        <div className={cn(cardCls, "overflow-hidden")}>
          {loading ? (
            <p className="px-5 py-7 text-center text-[13px] text-slate-500 dark:text-slate-400">
              Loading transactions…
            </p>
          ) : filteredSales.length === 0 ? (
            <p className="px-5 py-7 text-center text-[13px] text-slate-500 dark:text-slate-400">
              {sales.length === 0
                ? "No POS transactions are available yet."
                : "No transactions match these filters."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-[12.5px]">
                <thead className="bg-slate-50 text-[10.5px] uppercase tracking-[0.12em] text-slate-400 dark:bg-white/[0.035] dark:text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Date / sale</th>
                    <th className="px-4 py-3 font-semibold">Pharmacy / store</th>
                    <th className="px-4 py-3 font-semibold">Items</th>
                    <th className="px-4 py-3 font-semibold">Payment</th>
                    <th className="px-4 py-3 font-semibold">Served by</th>
                    <th className="px-4 py-3 font-semibold">Total</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {filteredSales.map((sale) => (
                    <tr key={sale.docId}>
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {formatDateTime(sale.soldAt)}
                        </p>
                        <p className="mt-0.5 font-mono text-[10.5px] text-slate-400">{sale.id}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-slate-800 dark:text-slate-100">
                          {sale.pharmacyName}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
                          {reportStoreName(sale)}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 tabular-nums text-slate-600 dark:text-slate-300">
                        {sale.lines.reduce((sum, line) => sum + line.qty, 0)} units ·{" "}
                        {sale.lines.length} product{sale.lines.length === 1 ? "" : "s"}
                      </td>
                      <td className="px-4 py-3.5 capitalize text-slate-600 dark:text-slate-300">
                        {sale.method === "mobile" ? "Mobile money" : sale.method}
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-slate-300">
                        {sale.servedBy}
                      </td>
                      <td className="px-4 py-3.5 font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatZMW(sale.total)}
                      </td>
                      <td className="px-4 py-3.5">
                        {sale.reversedAt ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[10.5px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                            <XCircle className="h-3 w-3" aria-hidden="true" />
                            Reversed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                            Completed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedSale(sale)}
                          className="rounded-md px-2.5 py-1.5 font-semibold text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-white/5"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMore && (
                <div className="border-t border-slate-100 p-3 text-center dark:border-white/5">
                  <button
                    type="button"
                    onClick={() => void loadOlderSales()}
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

      <Dialog open={selectedSale !== null} onOpenChange={(open) => !open && setSelectedSale(null)}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
          {selectedSale && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedSale.id}</DialogTitle>
                <DialogDescription>
                  {selectedSale.pharmacyName} · {reportStoreName(selectedSale)} ·{" "}
                  {formatDateTime(selectedSale.soldAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Cashier", selectedSale.servedBy],
                  ["Payment", selectedSale.method === "mobile" ? "Mobile money" : selectedSale.method],
                  ["Products", String(selectedSale.lines.length)],
                  ["Units", String(selectedSale.lines.reduce((sum, line) => sum + line.qty, 0))],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5"
                  >
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                      {label}
                    </p>
                    <p className="mt-1 truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-white/10">
                <table className="w-full min-w-[460px] text-left text-[12.5px]">
                  <thead className="bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-400 dark:bg-white/[0.035]">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Product</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Unit price</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Line total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {selectedSale.lines.map((line, index) => (
                      <tr key={`${line.productId}-${index}`}>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-slate-800 dark:text-slate-100">
                            {line.name}
                          </p>
                          <p className="text-[10.5px] text-slate-400">{line.productId}</p>
                          {line.stockAllocations?.length ? (
                            <p className="mt-1 text-[10.5px] text-slate-500 dark:text-slate-400">
                              Batches:{" "}
                              {line.stockAllocations
                                .map((batch) => `${batch.batch} × ${batch.qty}`)
                                .join(", ")}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {line.qty}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {formatZMW(line.unitPrice)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                          {formatZMW(line.qty * line.unitPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ml-auto grid w-full max-w-xs gap-2 text-[12.5px]">
                <p className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>Subtotal</span>
                  <span>{formatZMW(selectedSale.subtotal)}</span>
                </p>
                <p className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>Discount</span>
                  <span>{formatZMW(selectedSale.discount)}</span>
                </p>
                <p className="flex justify-between border-t border-slate-100 pt-2 text-[14px] font-bold text-slate-900 dark:border-white/10 dark:text-white">
                  <span>Total</span>
                  <span>{formatZMW(selectedSale.total)}</span>
                </p>
                {selectedSale.tendered !== undefined && (
                  <p className="flex justify-between text-slate-500 dark:text-slate-400">
                    <span>Cash tendered</span>
                    <span>{formatZMW(selectedSale.tendered)}</span>
                  </p>
                )}
                {selectedSale.change !== undefined && (
                  <p className="flex justify-between text-slate-500 dark:text-slate-400">
                    <span>Change</span>
                    <span>{formatZMW(selectedSale.change)}</span>
                  </p>
                )}
              </div>
              {selectedSale.reversedAt ? (
                <div className="rounded-xl bg-rose-50 px-4 py-3 text-[12px] text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
                  <p className="font-semibold">
                    Reversed {formatDateTime(selectedSale.reversedAt)} by{" "}
                    {selectedSale.reversedBy || "staff"}
                  </p>
                  <p className="mt-1">
                    Reason: {selectedSale.reversalReason || "No reason recorded"}
                  </p>
                  <p className="mt-1">
                    Refund handled: {selectedSale.refundHandled ? "Yes" : "No"}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
