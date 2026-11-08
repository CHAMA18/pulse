"use client";

import { motion } from "framer-motion";
import {
  ArrowUpDown,
  Ban,
  Boxes,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  Shapes,
  Store,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

type Supplier = {
  id: string;
  name: string;
  contact: string;
  email: string;
  category: string;
  leadDays: number;
  productsLinked: number;
  catalogueValue: number; // ZMW
  active: boolean;
  addedAt: number;
};

type StatusFilter = "active" | "inactive" | "all";
type SortKey = "name" | "lead" | "category";
type ViewMode = "list" | "grid";

const STORAGE_KEY = "pulse.suppliers.v1";

const CATEGORIES = [
  "Pharmaceuticals",
  "Medical Devices",
  "Consumables",
  "Equipment",
  "Supplements",
  "Other",
] as const;

/** The supplier that ships with every fresh console, mirroring the network seed. */
function seedSuppliers(): Supplier[] {
  return [
    {
      id: "sup-duniya",
      name: "Duniya",
      contact: "Jane Banda",
      email: "jane@duniyahealthcare.com",
      category: "Pharmaceuticals",
      leadDays: 14,
      productsLinked: 0,
      catalogueValue: 0,
      active: true,
      addedAt: Date.parse("2026-06-01T09:00:00Z"),
    },
  ];
}

function loadSuppliers(): Supplier[] {
  if (typeof window === "undefined") return seedSuppliers();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedSuppliers();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return seedSuppliers();
    return parsed.filter(
      (s): s is Supplier =>
        !!s && typeof s === "object" && typeof (s as Supplier).name === "string"
    );
  } catch {
    return seedSuppliers();
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `sup-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `sup-${Date.now().toString(36)}`;
}

/** Compact ZMW readout — mirrors the live console ("ZMW 0", "ZMW 12.5K"). */
function formatZmw(value: number): string {
  if (value <= 0) return "ZMW 0";
  if (value >= 1_000_000) return `ZMW ${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `ZMW ${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `ZMW ${Math.round(value)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/* ------------------------------------------------------------------ */
/* Add / Edit dialog                                                   */
/* ------------------------------------------------------------------ */

type FormState = {
  name: string;
  contact: string;
  email: string;
  category: string;
  leadDays: string;
  productsLinked: string;
  catalogueValue: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  contact: "",
  email: "",
  category: "Pharmaceuticals",
  leadDays: "7",
  productsLinked: "0",
  catalogueValue: "0",
};

function SupplierDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Supplier | null;
  onSave: (data: Omit<Supplier, "id" | "addedAt" | "active">) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    editing
      ? {
          name: editing.name,
          contact: editing.contact,
          email: editing.email,
          category: editing.category,
          leadDays: String(editing.leadDays),
          productsLinked: String(editing.productsLinked),
          catalogueValue: String(editing.catalogueValue),
        }
      : EMPTY_FORM
  );
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  const set = (key: keyof FormState) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = () => {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = "Supplier name is required.";
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim()))
      next.email = "That email doesn't look right.";
    const lead = Number(form.leadDays);
    if (!Number.isFinite(lead) || lead < 0) next.leadDays = "Enter a valid number of days.";
    const value = Number(form.catalogueValue);
    if (!Number.isFinite(value) || value < 0)
      next.catalogueValue = "Enter a valid amount.";
    const linked = Number(form.productsLinked);
    if (!Number.isFinite(linked) || linked < 0)
      next.productsLinked = "Enter a valid count.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onSave({
      name: form.name.trim(),
      contact: form.contact.trim() || form.name.trim(),
      email: form.email.trim(),
      category: form.category,
      leadDays: Math.max(0, Math.round(lead)),
      productsLinked: Math.max(0, Math.round(linked)),
      catalogueValue: Math.max(0, value),
    });
    onOpenChange(false);
  };

  const inputCls = (hasError?: string) =>
    cn(
      "flex h-10 w-full rounded-md border bg-white px-3 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 dark:bg-white/5 dark:text-white",
      hasError
        ? "border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-500/10 dark:border-rose-500/50"
        : "border-slate-200 hover:border-slate-300 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 dark:border-white/10 dark:hover:border-white/20 dark:focus:border-purple-400"
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit supplier" : "Add supplier"}</DialogTitle>
          <DialogDescription>
            {editing
              ? `Update the record for ${editing.name}.`
              : "Register a supplier on the Pulse network."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="sup-name">Supplier name</Label>
            <input
              id="sup-name"
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="e.g. Duniya Healthcare"
              autoComplete="off"
              className={inputCls(errors.name)}
            />
            {errors.name && <p className="text-xs text-rose-600 dark:text-rose-400">{errors.name}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sup-contact">Contact person</Label>
              <input
                id="sup-contact"
                value={form.contact}
                onChange={(e) => set("contact")(e.target.value)}
                placeholder="e.g. Jane Banda"
                autoComplete="off"
                className={inputCls()}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sup-email">Email</Label>
              <input
                id="sup-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email")(e.target.value)}
                placeholder="name@company.com"
                autoComplete="off"
                className={inputCls(errors.email)}
              />
              {errors.email && (
                <p className="text-xs text-rose-600 dark:text-rose-400">{errors.email}</p>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sup-category">Category</Label>
            <Select value={form.category} onValueChange={set("category")}>
              <SelectTrigger id="sup-category" className="h-10 w-full">
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sup-lead">Lead time (days)</Label>
              <input
                id="sup-lead"
                type="number"
                min={0}
                inputMode="numeric"
                value={form.leadDays}
                onChange={(e) => set("leadDays")(e.target.value)}
                className={inputCls(errors.leadDays)}
              />
              {errors.leadDays && (
                <p className="text-xs text-rose-600 dark:text-rose-400">{errors.leadDays}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sup-products">Products linked</Label>
              <input
                id="sup-products"
                type="number"
                min={0}
                inputMode="numeric"
                value={form.productsLinked}
                onChange={(e) => set("productsLinked")(e.target.value)}
                className={inputCls(errors.productsLinked)}
              />
              {errors.productsLinked && (
                <p className="text-xs text-rose-600 dark:text-rose-400">{errors.productsLinked}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sup-value">Catalogue value (ZMW)</Label>
              <input
                id="sup-value"
                type="number"
                min={0}
                inputMode="decimal"
                value={form.catalogueValue}
                onChange={(e) => set("catalogueValue")(e.target.value)}
                className={inputCls(errors.catalogueValue)}
              />
              {errors.catalogueValue && (
                <p className="text-xs text-rose-600 dark:text-rose-400">{errors.catalogueValue}</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="btn-brand h-10 rounded-md px-5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(168,85,247,0.7)]"
          >
            {editing ? "Save changes" : "Add supplier"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Import dialog — real CSV template download + real CSV parsing       */
/* ------------------------------------------------------------------ */

function ImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: Omit<Supplier, "id" | "addedAt" | "active">[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadTemplate = () => {
    const csv = [
      "Supplier Name,Contact Person,Email,Category,Lead Time (Days)",
      "Acme Pharma Ltd,John Mwale,john@acmepharma.zm,Pharmaceuticals,7",
      "MedSupply Co,Blessing Phiri,orders@medsupply.io,Consumables,10",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pulse-suppliers-template.csv";
    a.click();
    URL.revokeObjectURL(url);
    void trackEvent("supplier_import_template_download");
  };

  const onFile = async (file: File) => {
    setError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        setError("That file is empty.");
        return;
      }
      // Skip a header row when we detect one.
      const start = lines[0].toLowerCase().includes("supplier name") ? 1 : 0;
      const rows: Omit<Supplier, "id" | "addedAt" | "active">[] = [];
      let skipped = 0;
      for (const line of lines.slice(start)) {
        const cols = line.split(",").map((c) => c.trim());
        const [name, contact, email, category, lead] = cols;
        if (!name || (email && !EMAIL_RE.test(email))) {
          skipped += 1;
          continue;
        }
        rows.push({
          name,
          contact: contact || name,
          email: email || "",
          category: CATEGORIES.includes(category as (typeof CATEGORIES)[number])
            ? (category as Supplier["category"])
            : "Other",
          leadDays: Number.isFinite(Number(lead)) && Number(lead) >= 0 ? Math.round(Number(lead)) : 7,
          productsLinked: 0,
          catalogueValue: 0,
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
          <DialogTitle>Import suppliers</DialogTitle>
          <DialogDescription>
            Bulk-load your supplier list from a CSV file. Duplicate emails are
            skipped automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          {/* Step 1 — template */}
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
                Two example rows show the exact column order.
              </span>
            </span>
            <Download
              className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-y-0.5 group-hover:text-purple-500"
              aria-hidden="true"
            />
          </button>

          {/* Step 2 — pick file */}
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
                {error ? error : fileName ? fileName : "Columns: name, contact, email, category, lead days."}
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
/* Stat card                                                           */
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
      className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10"
    >
      <span
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-xl",
          tile
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={2.1} aria-hidden="true" />
      </span>
      <p className="mt-4 whitespace-nowrap text-[26px] font-bold leading-none tracking-tight text-slate-900 dark:text-white">
        {value}
      </p>
      <p className="mt-2 text-[13.5px] text-slate-500 dark:text-slate-400">{label}</p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Supplier row actions                                                */
/* ------------------------------------------------------------------ */

function RowActions({
  supplier,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  supplier: Supplier;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${supplier.name}`}
        title="Edit"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-amber-500 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-500/10"
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onToggleActive}
        aria-label={supplier.active ? `Deactivate ${supplier.name}` : `Reactivate ${supplier.name}`}
        title={supplier.active ? "Deactivate" : "Reactivate"}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
          supplier.active
            ? "text-orange-500 hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-500/10"
            : "text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/10"
        )}
      >
        {supplier.active ? (
          <Ban className="h-4 w-4" aria-hidden="true" />
        ) : (
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${supplier.name}`}
        title="Delete"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
        active
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
          : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          active ? "bg-emerald-500" : "bg-slate-400"
        )}
        aria-hidden="true"
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function SupplierManagement() {
  const { toast } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [view, setView] = useState<ViewMode>("list");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Supplier | null>(null);

  // Hydrate once on mount, then persist every change. Deferred to a frame
  // so we never setState synchronously inside the effect body.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setSuppliers(loadSuppliers());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(suppliers));
    } catch {
      /* storage full or unavailable — in-memory state still works */
    }
  }, [suppliers, hydrated]);

  /* ---------------- derived data ---------------- */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = suppliers.filter((s) => {
      if (statusFilter === "active" && !s.active) return false;
      if (statusFilter === "inactive" && s.active) return false;
      if (!q) return true;
      return [s.name, s.contact, s.email, s.category]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === "lead") return a.leadDays - b.leadDays;
      if (sortKey === "category") return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [suppliers, query, statusFilter, sortKey]);

  const stats = useMemo(() => {
    const products = suppliers.reduce((sum, s) => sum + s.productsLinked, 0);
    const value = suppliers.reduce((sum, s) => sum + s.catalogueValue, 0);
    const categories = new Set(suppliers.map((s) => s.category)).size;
    return { count: suppliers.length, products, value, categories };
  }, [suppliers]);

  /* ---------------- mutations ---------------- */

  const saveSupplier = (data: Omit<Supplier, "id" | "addedAt" | "active">) => {
    if (editing) {
      setSuppliers((prev) =>
        prev.map((s) => (s.id === editing.id ? { ...s, ...data } : s))
      );
      toast({ title: "Supplier updated", description: `${data.name} has been saved.` });
      void trackEvent("supplier_updated");
    } else {
      setSuppliers((prev) => [
        ...prev,
        { ...data, id: newId(), addedAt: Date.now(), active: true },
      ]);
      toast({ title: "Supplier added", description: `${data.name} joined the network.` });
      void trackEvent("supplier_added");
    }
    setEditing(null);
  };

  const toggleActive = (supplier: Supplier) => {
    setSuppliers((prev) =>
      prev.map((s) => (s.id === supplier.id ? { ...s, active: !s.active } : s))
    );
    toast({
      title: supplier.active ? "Supplier deactivated" : "Supplier reactivated",
      description: supplier.active
        ? `${supplier.name} is now hidden from the Active view.`
        : `${supplier.name} is back on the active roster.`,
    });
    void trackEvent(supplier.active ? "supplier_deactivated" : "supplier_reactivated");
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    setSuppliers((prev) => prev.filter((s) => s.id !== pendingDelete.id));
    toast({
      title: "Supplier deleted",
      description: `${pendingDelete.name} has been removed from the network.`,
    });
    void trackEvent("supplier_deleted");
    setPendingDelete(null);
  };

  const importRows = (rows: Omit<Supplier, "id" | "addedAt" | "active">[]) => {
    const existingEmails = new Set(
      suppliers.map((s) => s.email.trim().toLowerCase()).filter(Boolean)
    );
    const fresh: Supplier[] = [];
    let duplicates = 0;
    for (const row of rows) {
      const key = row.email.trim().toLowerCase();
      if (key && existingEmails.has(key)) {
        duplicates += 1;
        continue;
      }
      if (key) existingEmails.add(key);
      fresh.push({ ...row, id: newId(), addedAt: Date.now(), active: true });
    }
    setSuppliers((prev) => [...prev, ...fresh]);
    toast({
      title: `Imported ${fresh.length} supplier${fresh.length === 1 ? "" : "s"}`,
      description:
        duplicates > 0
          ? `${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped.`
          : "All rows imported cleanly.",
    });
    void trackEvent("supplier_imported", { imported: fresh.length, duplicates });
  };

  const openAdd = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
    void trackEvent("supplier_add_open");
  }, []);

  /* ---------------- render ---------------- */

  const filterChips: { id: StatusFilter; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "inactive", label: "Inactive" },
    { id: "all", label: "All" },
  ];

  const sortLabels: Record<SortKey, string> = {
    name: "Name",
    lead: "Lead time",
    category: "Category",
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col" data-tour="pulse-suppliers">
      {/* — Hero banner — */}
      <motion.section
        variants={item}
        aria-labelledby="supplier-mgmt-title"
        className="relative overflow-hidden rounded-3xl bg-[linear-gradient(105deg,#c026d3_0%,#9d2bec_46%,#7c3aed_100%)] px-5 py-7 shadow-[0_24px_60px_-24px_rgba(147,51,234,0.55)] sm:px-7"
      >
        {/* soft sheen */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(620px_200px_at_18%_0%,rgba(255,255,255,0.22),transparent_62%)]"
        />
        <div className="relative">
          <div className="flex items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
              <Store className="h-6 w-6 text-white" strokeWidth={2.1} aria-hidden="true" />
            </span>
            <h1
              id="supplier-mgmt-title"
              className="text-[24px] font-bold tracking-tight text-white sm:text-[26px]"
            >
              Supplier Management
            </h1>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setImportOpen(true);
                void trackEvent("supplier_import_open");
              }}
              className="inline-flex h-12 items-center justify-center gap-2.5 rounded-xl border border-white/35 bg-white/10 text-[15px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Upload className="h-[18px] w-[18px]" aria-hidden="true" />
              Import
            </button>
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex h-12 items-center justify-center gap-2.5 rounded-xl border border-white/50 bg-white/85 text-[15px] font-semibold text-purple-700 shadow-sm transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
              Add
            </button>
          </div>
        </div>
      </motion.section>

      {/* — Stat cards — */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          value={String(stats.count)}
          label="Suppliers"
          icon={Store}
          tile="bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
        />
        <StatCard
          value={String(stats.products)}
          label="Products Linked"
          icon={Boxes}
          tile="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"
        />
        <StatCard
          value={formatZmw(stats.value)}
          label="Catalogue Value"
          icon={CircleDollarSign}
          tile="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
        />
        <StatCard
          value={String(stats.categories)}
          label="Categories"
          icon={Shapes}
          tile="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
        />
      </div>

      {/* — Search & filters — */}
      <motion.section variants={item} aria-label="Search and filters" className="mt-6">
        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] sm:p-5 dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search suppliers..."
              aria-label="Search suppliers"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-11 pr-4 text-[14.5px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-slate-300 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20 dark:focus:border-purple-400"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {filterChips.map(({ id, label }) => {
              const active = statusFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(id)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                    active
                      ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                      : "bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-white/5 dark:text-purple-300 dark:hover:bg-white/10"
                  )}
                >
                  {label}
                </button>
              );
            })}

            {/* Sort */}
            <div className="ml-auto">
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="h-9 w-[150px] rounded-lg border-slate-200 bg-white text-[13.5px] font-medium dark:border-white/10 dark:bg-white/5">
                  <span className="flex min-w-0 items-center gap-2">
                    <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      Sort: {sortLabels[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </motion.section>

      {/* — Results header — */}
      <motion.div variants={item} className="mt-6 flex items-center justify-between gap-3">
        <p className="text-[13.5px] text-slate-500 dark:text-slate-400" aria-live="polite">
          {filtered.length} supplier{filtered.length === 1 ? "" : "s"}
          {statusFilter !== "all" && !query ? ` · ${statusFilter}` : ""}
        </p>
        <div
          role="group"
          aria-label="View mode"
          className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-white/5"
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
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
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

      {/* — Suppliers — */}
      {filtered.length === 0 ? (
        <motion.div
          variants={item}
          className="mt-3 flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-2xl bg-white p-8 text-center shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5">
            <SearchX className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-slate-800 dark:text-white">
              No suppliers found
            </p>
            <p className="mt-1 text-[13.5px] text-slate-500 dark:text-slate-400">
              {query
                ? `Nothing matches “${query}”. Try a different search.`
                : statusFilter === "inactive"
                  ? "Every supplier is currently active."
                  : "Add your first supplier to start building the network."}
            </p>
          </div>
          {!query && statusFilter !== "inactive" && (
            <button
              type="button"
              onClick={openAdd}
              className="btn-brand mt-1 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(168,85,247,0.7)]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add supplier
            </button>
          )}
        </motion.div>
      ) : view === "list" ? (
        <motion.section variants={item} aria-label="Suppliers" className="mt-3">
          <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-100 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:border-white/5 dark:text-slate-500">
                    <th scope="col" className="px-5 py-3.5 font-semibold">Supplier</th>
                    <th scope="col" className="px-5 py-3.5 font-semibold">Contact</th>
                    <th scope="col" className="px-5 py-3.5 font-semibold">Category</th>
                    <th scope="col" className="px-5 py-3.5 font-semibold">Lead</th>
                    <th scope="col" className="px-5 py-3.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((supplier) => (
                    <tr
                      key={supplier.id}
                      className="border-b border-slate-50 text-[14px] transition-colors last:border-0 hover:bg-purple-50/40 dark:border-white/5 dark:hover:bg-white/[0.03]"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              supplier.active ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                            )}
                            aria-hidden="true"
                          />
                          <span className="btn-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[14px] font-bold text-white">
                            {supplier.name[0]?.toUpperCase() ?? "?"}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900 dark:text-white">
                              {supplier.name}
                            </p>
                            <p className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">
                              {supplier.contact}
                              {supplier.email ? ` · ${supplier.email}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-600 dark:text-slate-300">
                        {supplier.contact}
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-block rounded-md bg-purple-50 px-2.5 py-1 text-[12.5px] font-semibold text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                          {supplier.category}
                        </span>
                      </td>
                      <td className="px-5 py-4 tabular-nums text-slate-600 dark:text-slate-300">
                        {supplier.leadDays}d
                      </td>
                      <td className="px-5 py-4">
                        <RowActions
                          supplier={supplier}
                          onEdit={() => {
                            setEditing(supplier);
                            setDialogOpen(true);
                          }}
                          onToggleActive={() => toggleActive(supplier)}
                          onDelete={() => setPendingDelete(supplier)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.section>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((supplier) => (
            <motion.article
              key={supplier.id}
              variants={item}
              className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10"
            >
              <div className="flex items-start gap-3">
                <span className="btn-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[16px] font-bold text-white">
                  {supplier.name[0]?.toUpperCase() ?? "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900 dark:text-white">
                    {supplier.name}
                  </p>
                  <p className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">
                    {supplier.email || supplier.contact}
                  </p>
                </div>
                <StatusPill active={supplier.active} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-[13px] dark:border-white/5">
                <div>
                  <dt className="text-slate-400 dark:text-slate-500">Contact</dt>
                  <dd className="mt-0.5 truncate font-medium text-slate-700 dark:text-slate-200">
                    {supplier.contact || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400 dark:text-slate-500">Category</dt>
                  <dd className="mt-0.5 font-medium text-purple-700 dark:text-purple-300">
                    {supplier.category}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400 dark:text-slate-500">Lead time</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-slate-700 dark:text-slate-200">
                    {supplier.leadDays}d
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400 dark:text-slate-500">Catalogue</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-slate-700 dark:text-slate-200">
                    {formatZmw(supplier.catalogueValue)}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/5">
                <RowActions
                  supplier={supplier}
                  onEdit={() => {
                    setEditing(supplier);
                    setDialogOpen(true);
                  }}
                  onToggleActive={() => toggleActive(supplier)}
                  onDelete={() => setPendingDelete(supplier)}
                />
              </div>
            </motion.article>
          ))}
        </div>
      )}

      {/* — dialogs — */}
      {/* key remounts the form whenever the dialog opens or the target
          supplier changes, so state always starts from a clean seed */}
      <SupplierDialog
        key={`${dialogOpen ? "open" : "closed"}-${editing?.id ?? "new"}`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSave={saveSupplier}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={importRows}
      />
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {pendingDelete?.name} and their catalogue
              links from the Pulse network. This action can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-rose-600"
            >
              Delete supplier
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </motion.div>
  );
}
