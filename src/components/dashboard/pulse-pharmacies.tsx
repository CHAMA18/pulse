"use client";

import { motion } from "framer-motion";
import {
  BriefcaseMedical,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  CircleX,
  FileDown,
  FileSpreadsheet,
  Hourglass,
  LayoutGrid,
  List,
  MapPin,
  RefreshCw,
  Search,
  SearchX,
  Store,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

type PharmacyStatus = "active" | "pending" | "rejected";

type Pharmacy = {
  id: string;
  name: string;
  address: string;
  ownerEmail: string | null; // null → "Owner not linked"
  registeredAt: number | null;
  status: PharmacyStatus;
  /** Firestore User uid when this row came from the network registry. */
  uid?: string;
};

type StatusFilter = "all" | "active" | "pending" | "rejected";
type ViewMode = "list" | "grid";

const STORAGE_KEY = "pulse.pharmacies.v1";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadPharmacies(): Pharmacy[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Pharmacy =>
        !!p &&
        typeof p === "object" &&
        typeof (p as Pharmacy).name === "string" &&
        !/^(phm-seed-|phm-pending-)/.test(String((p as Pharmacy).id ?? ""))
    );
  } catch {
    return [];
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `phm-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `phm-${Date.now().toString(36)}`;
}

function formatRegistered(ts: number | null): string {
  if (!ts) return "Registered —";
  return `Registered ${new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

const TEMPLATE_CSV = [
  "name,address,owner_email,status",
].join("\n");

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pulse-pharmacies-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

type ImportRow = {
  name: string;
  address: string;
  ownerEmail: string | null;
  status: PharmacyStatus;
};

function ImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: ImportRow[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setFileName(file.name);
    setError(null);
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0 && /^name\s*,/i.test(lines[0])) lines.shift();

      let skipped = 0;
      const rows: ImportRow[] = [];
      for (const line of lines) {
        const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        const [name, address, ownerEmail, status] = cols;
        if (!name) {
          skipped += 1;
          continue;
        }
        const cleanEmail = ownerEmail?.trim() || "";
        if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
          skipped += 1;
          continue;
        }
        const cleanStatus = (status?.trim().toLowerCase() || "pending");
        rows.push({
          name,
          address: address?.trim() || "",
          ownerEmail: cleanEmail || null,
          status: (["active", "pending", "rejected"] as const).includes(
            cleanStatus as PharmacyStatus
          )
            ? (cleanStatus as PharmacyStatus)
            : "pending",
        });
      }
      if (rows.length === 0) {
        setError(
          skipped > 0
            ? `No valid rows found (${skipped} skipped). Check the template's column order.`
            : "No valid rows found. Check the template's column order."
        );
        return;
      }
      onImport(rows);
      onOpenChange(false);
    } catch {
      setError("We couldn't read that file. Please try a plain .csv export.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setFileName(null);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Import reconciliation</DialogTitle>
          <DialogDescription>
            Bulk-load pharmacies from a registry CSV export. Duplicate names
            are skipped automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <button
            type="button"
            onClick={downloadTemplate}
            className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-left transition-colors hover:border-purple-200 hover:bg-purple-50/60 dark:border-white/10 dark:bg-white/5 dark:hover:border-purple-500/40 dark:hover:bg-purple-500/10"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold text-slate-800 dark:text-white">
                Step 1 · Download the CSV template
              </span>
              <span className="block text-[12.5px] text-slate-500 dark:text-slate-400">
                Columns: name, address, owner email, status.
              </span>
            </span>
            <FileDown
              className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-y-0.5 group-hover:text-purple-500"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              "group flex items-center gap-3 rounded-xl border border-dashed p-3.5 text-left transition-colors",
              error
                ? "border-rose-300 bg-rose-50/50 dark:border-rose-500/40 dark:bg-rose-500/5"
                : "border-slate-300 hover:border-purple-300 hover:bg-purple-50/50 dark:border-white/15 dark:hover:border-purple-500/40 dark:hover:bg-purple-500/10"
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
              <Upload className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold text-slate-800 dark:text-white">
                Step 2 · Choose your CSV file
              </span>
              <span className="block truncate text-[12.5px] text-slate-500 dark:text-slate-400">
                {error
                  ? error
                  : fileName
                    ? fileName
                    : "New pharmacies arrive as Pending Approval."}
              </span>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="CSV file to import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function StatCard({
  value,
  label,
  icon: Icon,
  tile,
}: {
  value: string;
  label: string;
  icon: LucideIcon;
  tile: string;
}) {
  return (
    <motion.div
      variants={item}
      className={cn(cardCls, "flex items-center gap-4 p-5")}
    >
      <span
        className={cn(
          "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl",
          tile
        )}
      >
        <Icon className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="whitespace-nowrap text-[26px] font-bold leading-none tracking-tight text-slate-900 dark:text-white">
          {value}
        </p>
        <p className="mt-1.5 whitespace-nowrap text-[13.5px] font-medium leading-none text-slate-500 dark:text-slate-400">
          {label}
        </p>
      </div>
    </motion.div>
  );
}

const STATUS_META: Record<
  PharmacyStatus,
  { label: string; pill: string }
> = {
  active: {
    label: "Active",
    pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  pending: {
    label: "Pending",
    pill: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  },
  rejected: {
    label: "Rejected",
    pill: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  },
};

function StatusPill({ status }: { status: PharmacyStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em]",
        meta.pill
      )}
    >
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PulsePharmacies() {
  const { toast } = useToast();

  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>("list");

  const [importOpen, setImportOpen] = useState(false);
  const [details, setDetails] = useState<Pharmacy | null>(null);

  // Hydrate once on mount, then persist every change. Deferred to a frame
  // so we never setState synchronously inside the effect body.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setPharmacies(loadPharmacies());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Network registry: pharmacies that registered through Firebase live on
  // their Firestore User profile — merge them in so a registration created
  // in the Pharmacy portal is visible (and approvable) here, on any device.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { getFirebaseDb } = await import("@/lib/firebase");
        const db = getFirebaseDb();
        if (!db) return;
        const { collection, getDocs, query, where } = await import("firebase/firestore");
        const snap = await getDocs(
          query(collection(db, "User"), where("account_type", "==", "Pharmacy"))
        );
        if (!active) return;
        const remote: Pharmacy[] = snap.docs.map((entry) => {
          const data = entry.data() as {
            pharmacy_name?: string;
            pharmacy_id?: string;
            email?: string;
            approved_by_duniya?: boolean;
          };
          return {
            id: data.pharmacy_id ?? entry.id,
            uid: entry.id,
            name: data.pharmacy_name?.trim() || "Unnamed pharmacy",
            address: "",
            ownerEmail: data.email ?? null,
            registeredAt: null,
            status: data.approved_by_duniya ? "active" : "pending",
          };
        });
        if (remote.length === 0) return;
        setPharmacies((prev) => {
          const byEmail = new Map(remote.map((p) => [(p.ownerEmail ?? "").toLowerCase(), p]));
          const merged = prev.map((p) => byEmail.get((p.ownerEmail ?? "").toLowerCase()) ?? p);
          const known = new Set(merged.map((p) => (p.ownerEmail ?? "").toLowerCase()));
          return [...merged, ...remote.filter((p) => !known.has((p.ownerEmail ?? "").toLowerCase()))];
        });
      } catch {
        /* offline or rules — the local registry remains the fallback */
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pharmacies));
    } catch {
      /* storage full or unavailable — in-memory state still works */
    }
  }, [pharmacies, hydrated]);

  /* ---------------- derived data ---------------- */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = pharmacies.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return [p.name, p.address, p.ownerEmail ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [pharmacies, query, statusFilter]);

  const stats = useMemo(() => {
    let active = 0;
    let pending = 0;
    let rejected = 0;
    for (const p of pharmacies) {
      if (p.status === "active") active += 1;
      else if (p.status === "pending") pending += 1;
      else rejected += 1;
    }
    return { total: pharmacies.length, active, pending, rejected };
  }, [pharmacies]);

  /* ---------------- mutations ---------------- */

  const changeStatus = (pharmacy: Pharmacy, status: PharmacyStatus) => {
    setPharmacies((prev) =>
      prev.map((p) => (p.id === pharmacy.id ? { ...p, status } : p))
    );
    // Registry-backed rows write through to Firestore, so approval is seen
    // by the pharmacy itself (approved_by_duniya) on its next sign-in.
    if (pharmacy.uid) {
      void (async () => {
        try {
          const { getFirebaseDb } = await import("@/lib/firebase");
          const db = getFirebaseDb();
          if (!db) return;
          const { doc, updateDoc } = await import("firebase/firestore");
          await updateDoc(doc(db, "User", pharmacy.uid!), {
            approved_by_duniya: status === "active",
          });
        } catch {
          /* best-effort — local status still reflects the decision here */
        }
      })();
    }
    setDetails((d) => (d && d.id === pharmacy.id ? { ...d, status } : d));
    const verb =
      status === "active" ? "approved" : status === "pending" ? "reset" : "rejected";
    toast({
      title:
        status === "active"
          ? "Pharmacy approved"
          : status === "rejected"
            ? "Listing rejected"
            : "Moved back to pending",
      description:
        status === "active"
          ? `${pharmacy.name} is now live on the Pulse network.`
          : status === "rejected"
            ? `${pharmacy.name} was removed from the active roster.`
            : `${pharmacy.name} is awaiting approval again.`,
    });
    void trackEvent("pharmacy_status_changed", { to: verb });
  };

  const refresh = () => {
    setPharmacies(loadPharmacies());
    toast({
      title: "Registry reloaded",
      description: `${pharmacies.length} saved pharmacy records loaded.`,
    });
    void trackEvent("pharmacies_refreshed");
  };

  const importRows = (rows: ImportRow[]) => {
    const existing = new Set(
      pharmacies.map((p) => p.name.trim().toLowerCase())
    );
    const fresh: Pharmacy[] = [];
    let duplicates = 0;
    for (const row of rows) {
      const key = row.name.trim().toLowerCase();
      if (existing.has(key)) {
        duplicates += 1;
        continue;
      }
      existing.add(key);
      fresh.push({ ...row, id: newId(), registeredAt: null });
    }
    setPharmacies((prev) => [...prev, ...fresh]);
    toast({
      title: `Imported ${fresh.length} pharmac${fresh.length === 1 ? "y" : "ies"}`,
      description:
        duplicates > 0
          ? `${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped.`
          : "All rows imported cleanly.",
    });
    void trackEvent("pharmacies_imported", { imported: fresh.length, duplicates });
  };

  /* ---------------- render ---------------- */

  const filterChips: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: stats.total },
    { id: "active", label: "Active", count: stats.active },
    { id: "pending", label: "Pending", count: stats.pending },
    { id: "rejected", label: "Rejected", count: stats.rejected },
  ];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col" data-tour="pulse-pharmacies">
      {/* — Hero banner — */}
      <motion.section
        variants={item}
        aria-labelledby="pulse-pharmacies-title"
        className="relative overflow-hidden rounded-3xl bg-[linear-gradient(105deg,#c026d3_0%,#9d2bec_46%,#7c3aed_100%)] px-5 py-7 shadow-[0_24px_60px_-24px_rgba(147,51,234,0.55)] sm:px-7"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(620px_200px_at_18%_0%,rgba(255,255,255,0.22),transparent_62%)]"
        />
        <div className="relative">
          <div className="flex items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
              <LayoutGrid className="h-6 w-6 text-white" strokeWidth={2.1} aria-hidden="true" />
            </span>
            <div>
              <h1
                id="pulse-pharmacies-title"
                className="text-[24px] font-bold tracking-tight text-white sm:text-[26px]"
              >
                Pulse Pharmacies
              </h1>
              <p className="mt-0.5 text-[13.5px] text-white/80">
                Every pharmacy on the Pulse network — onboarding, approvals and
                visibility in one console.
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* — Stat cards — */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          value={String(stats.total)}
          label="Total Pharmacies"
          icon={Store}
          tile="bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
        />
        <StatCard
          value={String(stats.active)}
          label="Active"
          icon={CircleCheck}
          tile="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
        />
        <StatCard
          value={String(stats.pending)}
          label="Pending Approval"
          icon={Hourglass}
          tile="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
        />
        <StatCard
          value={String(stats.rejected)}
          label="Rejected"
          icon={CircleX}
          tile="bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
        />
      </div>

      {/* — Registry actions — */}
      <motion.div variants={item} className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            downloadTemplate();
            void trackEvent("pharmacies_template_downloaded");
          }}
          className="inline-flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-800 shadow-sm transition-colors hover:bg-purple-50/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
        >
          <FileDown className="h-[18px] w-[18px] text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
          Template
        </button>
        <button
          type="button"
          onClick={() => {
            setImportOpen(true);
            void trackEvent("pharmacies_import_open");
          }}
          className="inline-flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-800 shadow-sm transition-colors hover:bg-purple-50/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
        >
          <FileSpreadsheet className="h-[18px] w-[18px] text-purple-500" aria-hidden="true" />
          Import reconciliation
        </button>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 text-[14px] font-semibold text-slate-800 shadow-sm transition-colors hover:bg-emerald-50/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:bg-white/[0.07] dark:text-slate-100 dark:hover:bg-white/10"
        >
          <RefreshCw className="h-[18px] w-[18px] text-emerald-500" aria-hidden="true" />
          Refresh
        </button>
      </motion.div>

      {/* — Search & filters — */}
      <motion.section variants={item} aria-label="Search and filters" className="mt-5">
        <div className={cn(cardCls, "p-4 sm:p-5")}>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, address, or owner email..."
              aria-label="Search pharmacies"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-[14.5px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-slate-300 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20 dark:focus:border-purple-400"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
            {filterChips.map(({ id, label, count }) => {
              const active = statusFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                    active
                      ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                      : "bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
                  )}
                >
                  {label}
                  <span
                    className={cn(
                      "min-w-[26px] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums",
                      active
                        ? "bg-white/20 text-white"
                        : "bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </motion.section>

      {/* — Results header — */}
      <motion.div variants={item} className="mt-6 flex items-center justify-between gap-3">
        <p className="text-[13.5px] text-slate-500 dark:text-slate-400" aria-live="polite">
          {filtered.length} pharmac{filtered.length === 1 ? "y" : "ies"}
        </p>
        <div
          role="group"
          aria-label="View mode"
          className={cn(
            "flex items-center gap-1 rounded-xl bg-white p-1 shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10"
          )}
        >
          {(
            [
              { id: "list" as ViewMode, label: "List", icon: List },
              { id: "grid" as ViewMode, label: "Grid", icon: LayoutGrid },
            ]
          ).map(({ id, label, icon: Icon }) => {
            const active = view === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setView(id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                  active
                    ? "bg-purple-600 text-white shadow-[0_6px_14px_-6px_rgba(147,51,234,0.7)]"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* — Pharmacies — */}
      {filtered.length === 0 ? (
        <motion.div
          variants={item}
          className={cn(cardCls, "mt-3 flex min-h-[180px] flex-col items-center justify-center gap-3 p-8 text-center")}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5">
            <SearchX className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-slate-800 dark:text-white">
              No pharmacies found
            </p>
            <p className="mt-1 text-[13.5px] text-slate-500 dark:text-slate-400">
              {query
                ? `Nothing matches “${query}”. Try a different name, address, or owner email.`
                : statusFilter === "pending"
                  ? "No pharmacies are awaiting approval right now."
                : statusFilter === "rejected"
                    ? "No listings have been rejected."
                    : pharmacies.length === 0
                      ? "No pharmacy records have been added. Import a verified registry file to get started."
                      : "Adjust the status filter to see more pharmacy records."}
            </p>
          </div>
        </motion.div>
      ) : view === "list" ? (
        <motion.section variants={item} aria-label="Pharmacies" className="mt-3 flex flex-col gap-4">
          {filtered.map((pharmacy) => (
            <motion.button
              key={pharmacy.id}
              variants={item}
              type="button"
              onClick={() => {
                setDetails(pharmacy);
                void trackEvent("pharmacy_details_opened");
              }}
              className={cn(
                cardCls,
                "group flex w-full items-center gap-4 p-4 text-left transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-[0_2px_6px_rgba(88,28,135,0.08),0_16px_36px_-20px_rgba(88,28,135,0.28)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 sm:p-5"
              )}
              aria-label={`Open ${pharmacy.name} details`}
            >
              <span className="btn-brand flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_8px_18px_-8px_rgba(147,51,234,0.7)]">
                <BriefcaseMedical className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
                  {pharmacy.name}
                </p>
                {pharmacy.address && (
                  <p className="mt-1.5 flex items-center gap-1.5 truncate text-[13px] text-slate-500 dark:text-slate-400">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="truncate">{pharmacy.address}</span>
                  </p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    {formatRegistered(pharmacy.registeredAt)}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5 shrink-0 text-slate-400"
                      aria-hidden="true"
                    >
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {pharmacy.ownerEmail ?? "Owner not linked"}
                    </span>
                  </span>
                </p>
              </div>

              <span className="flex shrink-0 items-center gap-2.5">
                <StatusPill status={pharmacy.status} />
                <ChevronRight
                  className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-purple-400 dark:text-slate-600"
                  aria-hidden="true"
                />
              </span>
            </motion.button>
          ))}
        </motion.section>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((pharmacy) => (
            <motion.button
              key={pharmacy.id}
              variants={item}
              type="button"
              onClick={() => {
                setDetails(pharmacy);
                void trackEvent("pharmacy_details_opened");
              }}
              className={cn(
                cardCls,
                "group flex flex-col p-5 text-left transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-[0_2px_6px_rgba(88,28,135,0.08),0_16px_36px_-20px_rgba(88,28,135,0.28)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
              )}
              aria-label={`Open ${pharmacy.name} details`}
            >
              <div className="flex items-start gap-3">
                <span className="btn-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_8px_18px_-8px_rgba(147,51,234,0.7)]">
                  <BriefcaseMedical className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold tracking-tight text-slate-900 dark:text-white">
                    {pharmacy.name}
                  </p>
                  {pharmacy.address && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-slate-500 dark:text-slate-400">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="truncate">{pharmacy.address}</span>
                    </p>
                  )}
                </div>
                <StatusPill status={pharmacy.status} />
              </div>

              <dl className="mt-4 flex-1 space-y-2.5 border-t border-slate-100 pt-4 text-[13px] dark:border-white/5">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-400 dark:text-slate-500">Registered</dt>
                  <dd className="font-medium text-slate-700 dark:text-slate-200">
                    {formatRegistered(pharmacy.registeredAt).replace("Registered ", "")}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="shrink-0 text-slate-400 dark:text-slate-500">Owner</dt>
                  <dd className="truncate font-medium text-slate-700 dark:text-slate-200">
                    {pharmacy.ownerEmail ?? "Owner not linked"}
                  </dd>
                </div>
              </dl>

              <span className="mt-4 inline-flex items-center gap-1.5 border-t border-slate-100 pt-3 text-[13px] font-semibold text-purple-600 transition-colors group-hover:text-purple-700 dark:border-white/5 dark:text-purple-400">
                View pharmacy
                <ChevronRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
            </motion.button>
          ))}
        </div>
      )}

      {/* — dialogs — */}
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={importRows}
      />

      <Dialog open={!!details} onOpenChange={(open) => { if (!open) setDetails(null); }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 pr-6">
              <span className="btn-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
                <BriefcaseMedical className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 truncate">{details?.name}</span>
            </DialogTitle>
            <DialogDescription className="pt-1">
              {details ? (
                <span className="inline-flex">
                  <StatusPill status={details.status} />
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <dl className="grid gap-3 py-1 text-[13.5px]">
            <div className="grid gap-1">
              <dt className="text-slate-400 dark:text-slate-500">Address</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">
                {details?.address || "—"}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-slate-400 dark:text-slate-500">Owner</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">
                {details?.ownerEmail ?? "Owner not linked"}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-slate-400 dark:text-slate-500">Registered</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">
                {details ? formatRegistered(details.registeredAt) : "—"}
              </dd>
            </div>
          </dl>

          {details && (
            <DialogFooter className="flex-wrap gap-2">
              {details.status === "pending" && (
                <>
                  <button
                    type="button"
                    onClick={() => changeStatus(details, "rejected")}
                    className="h-10 rounded-md border border-rose-200 px-4 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    Reject listing
                  </button>
                  <button
                    type="button"
                    onClick={() => changeStatus(details, "active")}
                    className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                  >
                    Approve listing
                  </button>
                </>
              )}
              {details.status === "active" && (
                <button
                  type="button"
                  onClick={() => changeStatus(details, "rejected")}
                  className="h-10 rounded-md border border-rose-200 px-4 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
                >
                  Revoke listing
                </button>
              )}
              {details.status === "rejected" && (
                <button
                  type="button"
                  onClick={() => changeStatus(details, "active")}
                  className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  Reinstate listing
                </button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
