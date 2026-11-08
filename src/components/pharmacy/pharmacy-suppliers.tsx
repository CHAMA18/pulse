"use client";

import { motion } from "framer-motion";
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarClock,
  Phone,
  Search,
  SearchX,
  Star,
  Store,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatZMW, loadSuppliers, type Supplier } from "@/components/pharmacy/pharmacy-data";
import { PageHeader, pharmacyCardCls } from "@/components/pharmacy/pharmacy-shared";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Directory                                                           */
/* ------------------------------------------------------------------ */

const CATEGORY_CHIPS = ["All", "Pharmaceuticals", "Consumables", "Supplements", "Equipment"];

const MONOGRAM_TONES = [
  "from-purple-500 to-fuchsia-600",
  "from-fuchsia-500 to-purple-600",
  "from-violet-500 to-purple-600",
  "from-purple-600 to-fuchsia-500",
];

function SupplierCard({
  supplier,
  index,
  onRequest,
}: {
  supplier: Supplier;
  index: number;
  onRequest: (supplier: Supplier) => void;
}) {
  const monogram = supplier.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <motion.article
      variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
      className={cn(pharmacyCardCls, "flex flex-col p-5")}
    >
      <div className="flex items-start gap-3.5">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-[14px] font-bold text-white",
            MONOGRAM_TONES[index % MONOGRAM_TONES.length]
          )}
          aria-hidden="true"
        >
          {monogram}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
              {supplier.name}
            </h3>
            {supplier.verified && (
              <BadgeCheck
                className="h-4 w-4 shrink-0 text-emerald-500"
                aria-label="Verified network supplier"
              />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {supplier.categories.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[12px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          {supplier.rating.toFixed(1)}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-[12.5px]">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5">
          <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Lead time
          </dt>
          <dd className="mt-1 font-bold text-slate-900 dark:text-white">{supplier.leadTime}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5">
          <dt className="text-slate-500 dark:text-slate-400">Min. order</dt>
          <dd className="mt-1 font-bold tabular-nums text-slate-900 dark:text-white">
            {formatZMW(supplier.minOrder)}
          </dd>
        </div>
      </dl>

      <p className="mt-3.5 flex items-center gap-1.5 truncate text-[12.5px] text-slate-500 dark:text-slate-400">
        <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {supplier.contact}
      </p>

      <button
        type="button"
        onClick={() => onRequest(supplier)}
        className="mt-4 inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 text-[13.5px] font-semibold text-purple-700 transition-colors hover:bg-purple-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-purple-500/25 dark:bg-purple-500/10 dark:text-purple-300 dark:hover:bg-purple-500/20"
      >
        Request stock
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </motion.article>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PharmacySuppliers({ onGoToRequests }: { onGoToRequests: () => void }) {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("All");

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setSuppliers(loadSuppliers());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return suppliers.filter((entry) => {
      const matchesChip = chip === "All" || entry.categories.includes(chip);
      const matchesQuery =
        !q ||
        entry.name.toLowerCase().includes(q) ||
        entry.categories.some((tag) => tag.toLowerCase().includes(q));
      return matchesChip && matchesQuery;
    });
  }, [suppliers, query, chip]);

  const onRequest = (supplier: Supplier) => {
    void trackEvent("pharmacy_supplier_request_click", { supplier: supplier.id });
    toast({
      title: `Requesting from ${supplier.name}`,
      description: "The stock request form is ready for you.",
    });
    onGoToRequests();
  };

  const EmptyIcon: LucideIcon = SearchX;

  return (
    <div aria-labelledby="pharmacy-suppliers-title">
      <PageHeader
        icon={Store}
        title="Supplier Directory"
        subtitle="Verified partners stocking your shelves across the network"
        tourId="ph-suppliers"
      />
      <h2 id="pharmacy-suppliers-title" className="sr-only">
        Supplier Directory
      </h2>

      {/* Search + category chips */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search suppliers or categories…"
            aria-label="Search supplier directory"
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
        <div role="radiogroup" aria-label="Filter by category" className="flex flex-wrap items-center gap-1.5">
          {CATEGORY_CHIPS.map((label) => {
            const active = chip === label;
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setChip(label)}
                className={cn(
                  "inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                  active
                    ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Supplier cards */}
      {hydrated && filtered.length === 0 ? (
        <div className={cn(pharmacyCardCls, "mt-5 flex min-h-[160px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center")}>
          <EmptyIcon className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
          <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
            No suppliers match {query.trim() ? `"${query.trim()}"` : "this filter"}.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setChip("All");
            }}
            className="text-[13px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
          >
            Clear search & filters
          </button>
        </div>
      ) : (
        <motion.div
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
          initial="hidden"
          animate="show"
          className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3"
        >
          {filtered.map((supplier, index) => (
            <SupplierCard key={supplier.id} supplier={supplier} index={index} onRequest={onRequest} />
          ))}
        </motion.div>
      )}

      <p className="mt-3 text-[12px] text-slate-400 dark:text-slate-500">
        {hydrated ? `${filtered.length} of ${suppliers.length} network suppliers` : "Loading directory…"} ·
        verified partners are audited by the Pulse network team
      </p>
    </div>
  );
}
