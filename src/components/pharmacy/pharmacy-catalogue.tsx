"use client";

import { motion } from "framer-motion";
import {
  ArrowDownUp,
  Download,
  FileSpreadsheet,
  Info,
  Plus,
  Search,
  SearchX,
  ShoppingCart,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatZMW,
  loadCatalogue,
  loadInventory,
  nextCatalogueId,
  nextId,
  saveCatalogue,
  saveInventory,
  stockForProduct,
  type CatalogueProduct,
  type InventoryItem,
  type PharmacyStore,
} from "@/components/pharmacy/pharmacy-data";
import {
  pharmacyCardCls,
  brandBtnCls,
  StatusPill,
  stockStatusOf,
} from "@/components/pharmacy/pharmacy-shared";
import { recordAudit } from "@/lib/audit-log";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PRODUCT_CATEGORIES } from "@/lib/product-categories";
import { trackEvent } from "@/lib/firebase";
import {
  findCatalogueProductByName,
  normaliseProductName,
  storeHasProduct,
} from "@/lib/pharmacy-catalogue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ------------------------------------------------------------------ */
/* Product Catalogue                                                   */
/* ------------------------------------------------------------------ */
/* The master list of everything the pharmacy sells — prices, packs,   */
/* prescription rules and live shelf stock, straight from the stores.  */

type SortKey = "name" | "price-asc" | "price-desc";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "name", label: "Name A–Z" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
];

type SpreadsheetProductRow = {
  rowNumber: number;
  name: string;
  category: string;
  unit: string;
  price: number;
  quantity: number;
  prescription: boolean;
  note: string;
  issues: string[];
};

function delimiterCount(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) {
      count += 1;
    }
  }
  return count;
}

function parseDelimitedText(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", "\t", ";"].sort(
    (left, right) => delimiterCount(firstLine, right) - delimiterCount(firstLine, left)
  )[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted && character === '"' && source[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  if (quoted) throw new Error("The spreadsheet has an unclosed quoted cell.");
  return rows;
}

function normaliseColumnName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseSpreadsheetNumber(value: string): number | null {
  const cleaned = value.trim().replace(/^(?:zmw|k)\s*/i, "").replace(/[\s,]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSpreadsheetBoolean(value: string): boolean {
  return ["yes", "true", "1", "rx", "y"].includes(value.trim().toLowerCase());
}

function parseProductSpreadsheet(
  text: string,
  hasStores: boolean
): SpreadsheetProductRow[] {
  const rows = parseDelimitedText(text);
  if (rows.length < 2) throw new Error("The spreadsheet needs a header row and at least one product row.");

  const headers = rows[0].map(normaliseColumnName);
  const findColumn = (aliases: string[]) =>
    headers.findIndex((header) => aliases.includes(header));
  const nameColumn = findColumn(["productname", "product", "name", "medicinename", "item", "itemname"]);
  const priceColumn = findColumn(["price", "pricezmw", "shelfprice", "shelfpricezmw", "retailprice", "sellingprice", "unitprice", "unitpricezmw", "priceperunit", "priceperunitzmw"]);
  const quantityColumn = findColumn(["quantity", "qty", "openingstock", "openingstockunits", "openingquantity", "openingqty", "stock", "stockquantity", "onhand", "quantityonhand", "units"]);
  const categoryColumn = findColumn(["category", "productcategory", "therapeuticcategory"]);
  const unitColumn = findColumn(["unit", "packunit", "sellingunit"]);
  const prescriptionColumn = findColumn(["prescription", "prescriptiononly", "rx"]);
  const noteColumn = findColumn(["note", "notes", "description"]);

  if (nameColumn < 0 || priceColumn < 0 || quantityColumn < 0) {
    throw new Error("Include these columns in the header row: Product name, Price (ZMW), and Quantity.");
  }

  const seenNames = new Set<string>();
  return rows.slice(1).map((cells, index) => {
    const cell = (column: number) => (column < 0 ? "" : cells[column] ?? "");
    const name = cell(nameColumn).trim();
    const priceValue = parseSpreadsheetNumber(cell(priceColumn));
    const quantityValue = parseSpreadsheetNumber(cell(quantityColumn));
    const issues: string[] = [];

    if (!name) issues.push("Product name is required.");
    if (priceValue === null || priceValue <= 0) issues.push("Enter a price greater than 0.");
    if (quantityValue === null || quantityValue < 0 || !Number.isInteger(quantityValue)) {
      issues.push("Quantity must be a whole number of 0 or more.");
    }
    if (quantityValue !== null && quantityValue > 0 && !hasStores) {
      issues.push("Add a store before importing positive stock quantities.");
    }

    const normalisedName = normaliseProductName(name);
    if (normalisedName && seenNames.has(normalisedName)) {
      issues.push("This product name appears more than once in the spreadsheet.");
    }
    if (normalisedName) seenNames.add(normalisedName);

    return {
      rowNumber: index + 2,
      name,
      category: cell(categoryColumn).trim() || "Uncategorised",
      unit: cell(unitColumn).trim() || "pack",
      price: priceValue ?? 0,
      quantity: quantityValue ?? 0,
      prescription: parseSpreadsheetBoolean(cell(prescriptionColumn)),
      note: cell(noteColumn).trim(),
      issues,
    };
  });
}

/** Small info icon that explains a form section on hover/focus. */
function FieldHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Hint: ${label}`}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-purple-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:text-slate-500 dark:hover:text-purple-400"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-left leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function KpiChip({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-[128px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
      <p className="text-[18px] font-bold leading-none tracking-tight tabular-nums">{value}</p>
      <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

export function PharmacyCatalogue({
  stores,
  onSell,
  canManage = true,
}: {
  stores: PharmacyStore[];
  /** Jump to the counter with this product ready to sell. */
  onSell?: () => void;
  /** Owners, managers and pharmacists may add or import products. */
  canManage?: boolean;
}) {
  const { toast } = useToast();

  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<SortKey>("name");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<SpreadsheetProductRow[]>([]);
  const [importFilename, setImportFilename] = useState("");
  const [importError, setImportError] = useState("");
  const [importStoreId, setImportStoreId] = useState("");
  const [isParsingImport, setIsParsingImport] = useState(false);
  const [actor, setActor] = useState({ name: "", email: "" });

  // Add-product form state
  const [form, setForm] = useState({
    name: "",
    category: "",
    unit: "pack",
    price: "",
    prescription: false,
    openingStock: "",
    lowStockTrigger: "",
    storeId: "",
    note: "",
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      const { getFirebaseAuth } = await import("@/lib/firebase");
      const auth = getFirebaseAuth();
      try {
        await auth?.authStateReady();
      } catch {
        /* fall through */
      }
      if (!active) return;
      const current = auth?.currentUser;
      setActor({
        name: current?.displayName ?? current?.email?.split("@")[0] ?? "Pharmacy Owner",
        email: current?.email ?? "",
      });
    })();

    const raf = requestAnimationFrame(() => {
      setProducts(loadCatalogue());
      setItems(loadInventory());
      setHydrated(true);
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category))).sort()],
    [products]
  );

  const categoryOptions = useMemo(() => {
    const existing = products.map((product) => product.category).filter(Boolean);
    return Array.from(new Set<string>([...PRODUCT_CATEGORIES, ...existing]));
  }, [products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = products.filter((product) => {
      const matchesQuery =
        !q || product.name.toLowerCase().includes(q) || product.category.toLowerCase().includes(q);
      const matchesCategory = category === "All" || product.category === category;
      return matchesQuery && matchesCategory;
    });
    switch (sort) {
      case "price-asc":
        return [...list].sort((a, b) => a.price - b.price);
      case "price-desc":
        return [...list].sort((a, b) => b.price - a.price);
      default:
        return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [products, query, category, sort]);

  const totalStock = (name: string) => stockForProduct(name, items, "all");
  const mainStore = stores.find((store) => store.isMain) ?? stores[0];
  const hasStores = stores.length > 0;

  const prescriptionCount = products.filter((product) => product.prescription).length;
  const avgPrice =
    products.length > 0
      ? Math.round(products.reduce((acc, product) => acc + product.price, 0) / products.length)
      : 0;

  const resetForm = () => {
    setForm({ name: "", category: "", unit: "pack", price: "", prescription: false, openingStock: "", lowStockTrigger: "", storeId: "", note: "" });
  };

  const resetImport = () => {
    setImportRows([]);
    setImportFilename("");
    setImportError("");
    setIsParsingImport(false);
  };

  const readImportFile = async (file: File) => {
    setImportFilename(file.name);
    setImportRows([]);
    setImportError("");
    setIsParsingImport(true);
    try {
      if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
        throw new Error("Save the spreadsheet as CSV or TSV, then choose that file here.");
      }
      const text = await file.text();
      const parsed = parseProductSpreadsheet(text, hasStores);
      setImportRows(parsed);
      if (parsed.length === 0) setImportError("No product rows were found in this spreadsheet.");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "This spreadsheet could not be read.");
    } finally {
      setIsParsingImport(false);
    }
  };

  const downloadImportTemplate = () => {
    const csv = [
      "Product name,Category,Unit,Price (ZMW),Quantity,Prescription,Note",
      '"Paracetamol 500mg (pack)",Analgesic,pack,15,25,false,"Optional shelf note"',
    ].join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pharmacy-products-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const canSubmit =
    form.name.trim().length > 1 &&
    form.category.trim().length > 1 &&
    form.unit.trim().length > 0 &&
    Number(form.price) > 0;

  // Live trigger preview for the add dialog: an explicit number wins, a blank
  // field follows the same "quarter of opening stock, minimum 5" rule the
  // shelf row will use.
  const draftOpeningQty = Math.max(0, Math.round(Number(form.openingStock) || 0));
  const autoTrigger = Math.max(5, Math.round(draftOpeningQty * 0.25));
  const draftTrigger =
    form.lowStockTrigger.trim() === ""
      ? autoTrigger
      : Math.max(0, Math.round(Number(form.lowStockTrigger) || 0));
  const triggerBelowOpening = draftOpeningQty > 0 && draftTrigger > draftOpeningQty;

  const addProduct = () => {
    if (!canSubmit) return;
    const name = form.name.trim();
    const openingQty = hasStores ? Math.max(0, Math.round(Number(form.openingStock) || 0)) : 0;
    const destinationStoreId = form.storeId || mainStore?.id;
    const destinationStore = stores.find((store) => store.id === destinationStoreId);
    const existingProduct = findCatalogueProductByName(products, name);
    const alreadyInStore = destinationStoreId
      ? storeHasProduct(destinationStoreId, name, items)
      : Boolean(existingProduct);

    if (alreadyInStore) {
      toast({
        title: "Already in this store",
        description: `"${name}" is already stocked${destinationStore ? ` in ${destinationStore.name}` : ""}. Adjust its stock through Stock Movement instead.`,
      });
      return;
    }

    // Blank trigger means "one quarter of the opening stock, minimum 5" — but
    // an explicit number is kept on the product so future bookings inherit it.
    const explicitTrigger =
      form.lowStockTrigger.trim() === ""
        ? undefined
        : Math.max(0, Math.round(Number(form.lowStockTrigger) || 0));

    // The catalogue record is shared by every store. Reuse it when the product
    // is being stocked in a new store instead of creating a duplicate.
    if (existingProduct) {
      if (!destinationStoreId || openingQty <= 0) {
        toast({
          title: "Already in the catalogue",
          description: `"${name}" is already in your catalogue. Choose a store and enter opening stock to add it there.`,
        });
        return;
      }
      const reorderLevel =
        explicitTrigger ??
        existingProduct.lowStockTrigger ??
        Math.max(5, Math.round(openingQty * 0.25));
      const nextItems: InventoryItem[] = [
        ...items,
        {
          id: nextId(items, "inv"),
          name: existingProduct.name,
          category: existingProduct.category,
          batch: `NEW-${new Date().getFullYear()}-${String(items.length + 1).padStart(2, "0")}`,
          expiry: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          qty: openingQty,
          reorderLevel,
          unitPrice: existingProduct.price,
          storeId: destinationStoreId,
          productId: existingProduct.id,
        },
      ];
      setItems(nextItems);
      saveInventory(nextItems);

      if (actor.email) {
        recordAudit({
          title: "Opening Stock Added",
          action: "Update",
          detail: `${existingProduct.name} · ${openingQty} units to ${destinationStore?.name ?? "store"}`,
          actor: actor.name,
          email: actor.email,
        });
      }
      void trackEvent("pharmacy_catalogue_store_stocked", {
        product: existingProduct.id,
        store: destinationStoreId,
      });
      toast({
        title: `Opening stock added to ${destinationStore?.name ?? "store"}`,
        description: `${openingQty} units of ${existingProduct.name} are now on that store's shelves.`,
      });
      setAddOpen(false);
      resetForm();
      return;
    }

    const reorderLevel = explicitTrigger ?? Math.max(5, Math.round(openingQty * 0.25));

    const product: CatalogueProduct = {
      id: nextCatalogueId(products),
      name,
      category: form.category.trim(),
      unit: form.unit.trim() || "unit",
      price: Number(form.price),
      prescription: form.prescription,
      note: form.note.trim() || undefined,
      ...(explicitTrigger !== undefined ? { lowStockTrigger: explicitTrigger } : {}),
      createdAt: Date.now(),
    };
    const nextProducts = [...products, product];
    setProducts(nextProducts);
    saveCatalogue(nextProducts);

    // Opening stock lands on the chosen store's shelves as a fresh batch.
    if (openingQty > 0 && destinationStoreId) {
      const nextItems: InventoryItem[] = [
        ...items,
        {
          id: nextId(items, "inv"),
          name,
          category: product.category,
          batch: `NEW-${new Date().getFullYear()}-${String(items.length + 1).padStart(2, "0")}`,
          expiry: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          qty: openingQty,
          reorderLevel,
          unitPrice: product.price,
          storeId: destinationStoreId,
          productId: product.id,
        },
      ];
      setItems(nextItems);
      saveInventory(nextItems);
    }

    if (actor.email) {
      recordAudit({
        title: "Product Added",
        action: "Update",
        detail: `${product.name} · ${formatZMW(product.price)} per ${product.unit}${openingQty > 0 ? ` · ${openingQty} to shelves` : ""}`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_catalogue_added", { product: product.id });

    toast({
      title: `${product.name} added`,
      description:
        openingQty > 0
          ? `${openingQty} units booked into ${destinationStore?.name ?? "the main store"}.`
          : "Added to the catalogue — book stock in from Inventory when it arrives.",
    });
    setAddOpen(false);
    resetForm();
  };

  const importStore = stores.find(
    (store) => store.id === (importStoreId || mainStore?.id)
  );
  const checkedImportRows = useMemo(
    () =>
      importRows.map((row) => {
        if (!importStore || row.issues.length > 0) return row;
        if (!storeHasProduct(importStore.id, row.name, items)) return row;
        return {
          ...row,
          issues: [...row.issues, `Already stocked in ${importStore.name}.`],
        };
      }),
    [importRows, importStore, items]
  );
  const validImportRows = checkedImportRows.filter((row) => row.issues.length === 0);
  const importProducts = () => {
    if (validImportRows.length === 0) return;
    const destinationStoreId = importStore?.id;
    if (!destinationStoreId && validImportRows.some((row) => row.quantity > 0)) {
      setImportError("Add a store before importing products with stock.");
      return;
    }

    const now = Date.now();
    const nextProducts = [...products];
    const nextItems = [...items];
    const existingByName = new Map<string, CatalogueProduct>();
    for (const product of products) {
      existingByName.set(normaliseProductName(product.name), product);
    }
    let catalogueChanged = false;
    let stockLinesAdded = 0;
    let unitsAdded = 0;
    for (const row of validImportRows) {
      let product = existingByName.get(normaliseProductName(row.name));
      if (!product) {
        product = {
          id: nextCatalogueId(nextProducts),
          name: row.name,
          category: row.category,
          unit: row.unit,
          price: row.price,
          prescription: row.prescription,
          note: row.note || undefined,
          createdAt: now,
        };
        nextProducts.push(product);
        existingByName.set(normaliseProductName(product.name), product);
        catalogueChanged = true;
      }

      if (row.quantity > 0 && destinationStoreId) {
        nextItems.push({
          id: nextId(nextItems, "inv"),
          name: product.name,
          category: product.category,
          batch: `IMP-${new Date(now).getFullYear()}-${String(nextItems.length + 1).padStart(3, "0")}`,
          expiry: new Date(now + 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          qty: row.quantity,
          reorderLevel: Math.max(5, Math.round(row.quantity * 0.25)),
          unitPrice: product.price,
          storeId: destinationStoreId,
          productId: product.id,
        });
        stockLinesAdded += 1;
        unitsAdded += row.quantity;
      }
    }

    if (catalogueChanged) {
      setProducts(nextProducts);
      saveCatalogue(nextProducts);
    }
    if (stockLinesAdded > 0) {
      setItems(nextItems);
      saveInventory(nextItems);
    }
    if (actor.email) {
      recordAudit({
        title: "Products Imported",
        action: "Update",
        detail: `${validImportRows.length} product${validImportRows.length === 1 ? "" : "s"} imported${unitsAdded > 0 ? ` · ${unitsAdded} opening units added` : ""}`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_catalogue_imported", { count: validImportRows.length });

    const skipped = importRows.length - validImportRows.length;
    toast({
      title: `${validImportRows.length} product${validImportRows.length === 1 ? "" : "s"} imported`,
      description: unitsAdded > 0
        ? `${unitsAdded} opening unit${unitsAdded === 1 ? "" : "s"} added to ${importStore?.name ?? "the selected store"}.${skipped > 0 ? ` ${skipped} row${skipped === 1 ? " was" : "s were"} skipped.` : ""}`
        : `Product data was imported without opening stock.${skipped > 0 ? ` ${skipped} row${skipped === 1 ? " was" : "s were"} skipped.` : ""}`,
    });
    setImportOpen(false);
    resetImport();
  };

  const SortIcon: LucideIcon = ArrowDownUp;
  const NoIcon: LucideIcon = SearchX;

  return (
    <div aria-labelledby="pharmacy-catalogue-title">
      <h3 id="pharmacy-catalogue-title" className="sr-only">
        Product Catalogue
      </h3>

      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-3">
        <p className="min-w-[min(100%,220px)] flex-1 text-[13px] text-slate-500 dark:text-slate-400">
          Every product you sell — prices, packs, prescription rules and live stock.
        </p>
        {canManage && (
          <div className="flex w-full flex-wrap items-center gap-2.5 sm:ml-auto sm:w-auto sm:shrink-0">
            <button
              type="button"
              onClick={() => {
                setImportStoreId(mainStore?.id ?? "");
                setImportOpen(true);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Import spreadsheet
            </button>
            <button type="button" onClick={() => setAddOpen(true)} className={cn(brandBtnCls, "h-10 px-4 text-[13.5px] font-semibold")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add product
            </button>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className={cn(pharmacyCardCls, "mt-4 flex flex-wrap gap-3 p-4")}>
        <KpiChip value={String(hydrated ? products.length : "—")} label="Products" />
        <KpiChip value={String(hydrated ? categories.length - 1 : "—")} label="Categories" />
        <KpiChip value={String(hydrated ? prescriptionCount : "—")} label="Prescription only" />
        <KpiChip value={hydrated ? formatZMW(avgPrice) : "—"} label="Avg. shelf price" />
      </div>

      {/* Search + filters */}
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
            placeholder="Search by product or category…"
            aria-label="Search catalogue"
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
        <label className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 dark:border-white/10 dark:bg-white/5">
          <SortIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Sort catalogue</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort catalogue"
            className="cursor-pointer bg-transparent text-[13px] font-medium text-slate-600 outline-none dark:text-slate-200"
          >
            {SORTS.map(({ id, label }) => (
              <option key={id} value={id} className="text-slate-900">
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Category chips */}
      <div className="pulse-scroll mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Catalogue categories">
        {categories.map((cat) => {
          const active = category === cat;
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategory(cat)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                active
                  ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
              )}
            >
              {cat}
              {cat !== "All" && (
                <span className={cn("ml-1.5 text-[11px] font-bold", active ? "text-white/70" : "text-slate-400")}>
                  {products.filter((product) => product.category === cat).length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Product grid */}
      {visible.length === 0 ? (
        <div className={cn(pharmacyCardCls, "mt-4 flex min-h-[160px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center")}>
          <NoIcon className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
          {products.length === 0 ? (
            <>
              <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
                No products yet — add your first product to start the catalogue.
              </p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="text-[13px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
                >
                  Add product
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
                No products match {query.trim() ? `"${query.trim()}"` : "this filter"}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory("All");
                }}
                className="text-[13px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
              >
                Clear search & filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((product) => {
            const stock = totalStock(product.name);
            const status = stockStatusOf(stock, 1);
            return (
              <motion.article
                key={product.id}
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                className={cn(pharmacyCardCls, "flex flex-col p-5")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-bold text-slate-900 dark:text-white">{product.name}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                      {product.category} · per {product.unit}
                    </p>
                  </div>
                  {product.prescription && (
                    <span
                      title="Prescription only"
                      className="inline-flex h-6 shrink-0 items-center rounded-md bg-rose-100 px-2 text-[10.5px] font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                    >
                      Rx
                    </span>
                  )}
                </div>

                {product.note && (
                  <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">
                    {product.note}
                  </p>
                )}

                <div className="mt-3 flex items-end justify-between gap-3">
                  <span className="text-[20px] font-bold leading-none tracking-tight text-purple-700 dark:text-purple-300">
                    {formatZMW(product.price)}
                  </span>
                  <StatusPill
                    status={status}
                    label={status === "out" ? "No stock" : `${stock} on shelves`}
                  />
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

      {products.length > 0 && (
      <p className="mt-3 text-[12px] text-slate-400 dark:text-slate-500">
        Showing {visible.length} of {products.length} products · stock totals roll up from every store ·{" "}
        <button
          type="button"
          onClick={onSell}
          className="inline-flex items-center gap-1 font-semibold text-purple-600 hover:underline dark:text-purple-400"
        >
          <ShoppingCart className="h-3 w-3" aria-hidden="true" />
          sell from the counter
        </button>
      </p>
      )}

      {/* Add product */}
      <Dialog open={addOpen} onOpenChange={(open) => (open ? setAddOpen(true) : (setAddOpen(false), resetForm()))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a product</DialogTitle>
            <DialogDescription>
              New products join the catalogue; opening stock is booked into the selected store. Existing catalogue products can be stocked in another store without duplication.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="cat-name">Product name</Label>
                <FieldHint label="Product name">
                  Use the exact shelf name, including strength and pack size. Names must be unique within
                  each store.
                </FieldHint>
              </div>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Azithromycin 250mg (pack)"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="cat-category">Category</Label>
                  <FieldHint label="Category">
                    Groups the product on the catalogue and powers the category filters. Choose the closest
                    therapeutic category.
                  </FieldHint>
                </div>
                <Select
                  value={form.category}
                  onValueChange={(value) => setForm({ ...form, category: value })}
                >
                  <SelectTrigger id="cat-category" className="w-full">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="cat-unit">Pack unit</Label>
                  <FieldHint label="Pack unit">
                    The unit customers buy — pack, box, bottle or caps. Price and stock are tracked per this
                    unit.
                  </FieldHint>
                </div>
                <Input
                  id="cat-unit"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="pack, box, bottle…"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="cat-price">Shelf price (ZMW)</Label>
                  <FieldHint label="Shelf price">
                    Retail price in Zambian Kwacha for one pack unit. Catalogue and stock values are derived
                    from it.
                  </FieldHint>
                </div>
                <Input
                  id="cat-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="cat-stock">Opening stock</Label>
                  <FieldHint label="Opening stock">
                    Units already on the shelf. Leave at 0 to add the product without booking stock; receive it
                    later from Stock Movement.
                  </FieldHint>
                </div>
                <Input
                  id="cat-stock"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  disabled={!hasStores}
                  value={form.openingStock}
                  onChange={(e) => setForm({ ...form, openingStock: e.target.value })}
                  placeholder={hasStores ? "0" : "Add a store first"}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="cat-trigger">Low stock trigger</Label>
                  <FieldHint label="Low stock trigger">
                    Units on hand that mark this shelf low — the bell, the Stock Balance badge and
                    the low-stock email all use it. Leave blank to use a quarter of the opening
                    stock (minimum 5). Set 0 to only flag the shelf once it is sold out.
                  </FieldHint>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-400">
                  {form.lowStockTrigger.trim() === "" ? `Auto · ${autoTrigger}` : `Alerts at ≤ ${draftTrigger}`}
                </span>
              </div>
              <Input
                id="cat-trigger"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.lowStockTrigger}
                onChange={(e) => setForm({ ...form, lowStockTrigger: e.target.value })}
                placeholder={`${autoTrigger} units`}
                aria-describedby="cat-trigger-note"
              />
              <p
                id="cat-trigger-note"
                className={cn(
                  "text-[11.5px] leading-snug",
                  triggerBelowOpening
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-slate-400 dark:text-slate-500"
                )}
              >
                {triggerBelowOpening
                  ? `Opening stock (${draftOpeningQty}) is already at or below this trigger — the shelf will flag low as soon as it is added.`
                  : `This shelf will raise a low-stock alert at ${draftTrigger} ${draftTrigger === 1 ? "unit" : "units"} and below.`}
              </p>
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="cat-store">Opening stock destination</Label>
                <FieldHint label="Opening stock destination">
                  The store whose shelves receive the opening stock. Defaults to your main store.
                </FieldHint>
              </div>
              <Select
                value={form.storeId || mainStore?.id || ""}
                onValueChange={(v) => setForm({ ...form, storeId: v })}
                disabled={!hasStores}
              >
                <SelectTrigger id="cat-store" className="w-full">
                  <SelectValue placeholder="Choose a store" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                      {store.isMain ? " (main)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!hasStores && (
                <p className="text-[12px] text-amber-600 dark:text-amber-400">
                  Add a store under Stores first — opening stock needs a shelf to land on.
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="cat-note">Shelf note (optional)</Label>
                <FieldHint label="Shelf note">
                  One short line customers and staff see on the product card and at the counter.
                </FieldHint>
              </div>
              <Textarea
                id="cat-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="One line customers and staff will see on the card"
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 dark:bg-white/5">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="cat-rx" className="text-[13.5px]">
                    Prescription only
                  </Label>
                  <FieldHint label="Prescription only">
                    Flags the product as Rx — it can only be sold against a valid prescription at the counter.
                  </FieldHint>
                </div>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">
                  Sold against a valid prescription — flagged Rx at the counter.
                </p>
              </div>
              <Switch
                id="cat-rx"
                checked={form.prescription}
                onCheckedChange={(checked) => setForm({ ...form, prescription: checked })}
              />
            </div>
          </div>

          <DialogFooter className="mt-1">
            <button
              type="button"
              onClick={() => {
                setAddOpen(false);
                resetForm();
              }}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addProduct}
              disabled={!canSubmit}
              className={cn(brandBtnCls, "h-10 px-4 text-[13.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none")}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add to catalogue
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) resetImport();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import products from a spreadsheet</DialogTitle>
            <DialogDescription>
              Add products with their shelf prices and opening quantities. Existing catalogue products are stocked in the selected store without being duplicated.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  id="cat-import-file"
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void readImportFile(file);
                  }}
                />
                <label
                  htmlFor="cat-import-file"
                  className={cn(brandBtnCls, "inline-flex h-10 cursor-pointer px-4 text-[13px] font-semibold")}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Choose CSV or TSV
                </label>
                <button
                  type="button"
                  onClick={downloadImportTemplate}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/10"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download template
                </button>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                Save an Excel or Google Sheets file as CSV or TSV first. Required columns: Product name, Price (ZMW), and Quantity. Category and Unit are optional; defaults are Uncategorised and pack.
              </p>
              {importFilename && (
                <p className="mt-2 truncate text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                  Selected: {importFilename}
                </p>
              )}
            </div>

            {hasStores ? (
              <div className="grid gap-1.5">
                <Label htmlFor="cat-import-store">Opening stock destination</Label>
                <Select
                  value={importStoreId || mainStore?.id || ""}
                  onValueChange={setImportStoreId}
                >
                  <SelectTrigger id="cat-import-store" className="w-full">
                    <SelectValue placeholder="Choose a store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}{store.isMain ? " (main)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Already in your catalogue? It can be stocked in another store. Only a duplicate in
                  this store is skipped.
                </p>
              </div>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                Add a store before importing products with a quantity above 0. Products with quantity 0 can still be added.
              </p>
            )}

            {isParsingImport && (
              <p role="status" className="text-[13px] text-slate-500 dark:text-slate-400">Reading spreadsheet…</p>
            )}
            {importError && (
              <p role="alert" className="rounded-lg bg-rose-50 px-3.5 py-3 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                {importError}
              </p>
            )}

            {importRows.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3 dark:bg-white/5">
                  <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    {validImportRows.length} ready · {importRows.length - validImportRows.length} skipped
                  </p>
                  <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Review before importing</p>
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full min-w-[520px] text-left text-[12.5px]">
                    <thead className="sticky top-0 bg-white text-[10.5px] uppercase tracking-wide text-slate-400 dark:bg-slate-900">
                      <tr>
                        <th className="px-3 py-2">Row / product</th>
                        <th className="px-3 py-2 text-right">Quantity</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2">Import status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {checkedImportRows.slice(0, 100).map((row) => (
                        <tr key={`${row.rowNumber}-${row.name}`} className={row.issues.length ? "bg-rose-50/60 dark:bg-rose-500/5" : ""}>
                          <td className="max-w-[220px] px-3 py-2">
                            <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{row.rowNumber}. {row.name || "Unnamed product"}</p>
                            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{row.category} · {row.unit}</p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.price > 0 ? formatZMW(row.price) : "—"}</td>
                          <td className="max-w-[210px] px-3 py-2">
                            {row.issues.length === 0 ? (
                              <span className="font-semibold text-emerald-700 dark:text-emerald-300">Ready</span>
                            ) : (
                              <span className="text-[11.5px] text-rose-700 dark:text-rose-300">{row.issues.join(" ")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {importRows.length > 100 && (
                  <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:border-white/5 dark:text-slate-400">
                    Showing the first 100 rows. All {importRows.length} rows will be checked when imported.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="mt-1">
            <button
              type="button"
              onClick={() => {
                setImportOpen(false);
                resetImport();
              }}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={importProducts}
              disabled={isParsingImport || validImportRows.length === 0}
              className={cn(brandBtnCls, "h-10 px-4 text-[13.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none")}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Import {validImportRows.length} valid product{validImportRows.length === 1 ? "" : "s"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
