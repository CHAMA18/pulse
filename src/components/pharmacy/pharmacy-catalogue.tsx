"use client";

import { motion } from "framer-motion";
import {
  ArrowDownUp,
  PackageSearch,
  Plus,
  Search,
  SearchX,
  ShoppingCart,
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
  PageHeader,
  pharmacyCardCls,
  brandBtnCls,
  StatusPill,
  stockStatusOf,
} from "@/components/pharmacy/pharmacy-shared";
import { recordAudit } from "@/lib/audit-log";
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
}: {
  stores: PharmacyStore[];
  /** Jump to the counter with this product ready to sell. */
  onSell?: () => void;
}) {
  const { toast } = useToast();

  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<SortKey>("name");
  const [addOpen, setAddOpen] = useState(false);
  const [actor, setActor] = useState({ name: "", email: "" });

  // Add-product form state
  const [form, setForm] = useState({
    name: "",
    category: "",
    unit: "pack",
    price: "",
    prescription: false,
    openingStock: "",
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

  const prescriptionCount = products.filter((product) => product.prescription).length;
  const avgPrice =
    products.length > 0
      ? Math.round(products.reduce((acc, product) => acc + product.price, 0) / products.length)
      : 0;

  const resetForm = () => {
    setForm({ name: "", category: "", unit: "pack", price: "", prescription: false, openingStock: "", storeId: "", note: "" });
  };

  const canSubmit =
    form.name.trim().length > 1 &&
    form.category.trim().length > 1 &&
    form.unit.trim().length > 0 &&
    Number(form.price) > 0;

  const addProduct = () => {
    if (!canSubmit) return;
    const name = form.name.trim();
    if (products.some((product) => product.name.toLowerCase() === name.toLowerCase())) {
      toast({
        title: "Already in the catalogue",
        description: `"${name}" is on the shelf list — adjust its stock from Inventory instead.`,
      });
      return;
    }

    const product: CatalogueProduct = {
      id: nextCatalogueId(products),
      name,
      category: form.category.trim(),
      unit: form.unit.trim() || "unit",
      price: Number(form.price),
      prescription: form.prescription,
      note: form.note.trim() || undefined,
      createdAt: Date.now(),
    };
    const nextProducts = [...products, product];
    setProducts(nextProducts);
    saveCatalogue(nextProducts);

    // Opening stock lands on the chosen store's shelves as a fresh batch.
    const openingQty = Math.max(0, Math.round(Number(form.openingStock) || 0));
    if (openingQty > 0) {
      const nextItems: InventoryItem[] = [
        ...items,
        {
          id: nextId(items, "inv"),
          name,
          category: product.category,
          batch: `NEW-${new Date().getFullYear()}-${String(items.length + 1).padStart(2, "0")}`,
          expiry: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          qty: openingQty,
          reorderLevel: Math.max(5, Math.round(openingQty * 0.25)),
          unitPrice: product.price,
          storeId: (form.storeId || mainStore?.id) as string,
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
          ? `${openingQty} units booked into ${stores.find((s) => s.id === (form.storeId || mainStore?.id))?.name ?? "the main store"}.`
          : "Added to the catalogue — book stock in from Inventory when it arrives.",
    });
    setAddOpen(false);
    resetForm();
  };

  const SortIcon: LucideIcon = ArrowDownUp;
  const NoIcon: LucideIcon = SearchX;

  return (
    <div aria-labelledby="pharmacy-catalogue-title">
      <PageHeader
        icon={PackageSearch}
        title="Product Catalogue"
        subtitle="Every product you sell — prices, packs, prescription rules and live stock"
        tourId="ph-catalogue"
        actions={
          <button type="button" onClick={() => setAddOpen(true)} className={cn(brandBtnCls, "h-10 px-4 text-[13.5px] font-semibold")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add product
          </button>
        }
      />
      <h2 id="pharmacy-catalogue-title" className="sr-only">
        Product Catalogue
      </h2>

      {/* KPIs */}
      <div className={cn(pharmacyCardCls, "mt-5 flex flex-wrap gap-3 p-4")}>
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

      {/* Add product */}
      <Dialog open={addOpen} onOpenChange={(open) => (open ? setAddOpen(true) : (setAddOpen(false), resetForm()))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a product</DialogTitle>
            <DialogDescription>
              New products join the catalogue instantly — opening stock lands on the chosen store's shelves.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cat-name">Product name</Label>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Azithromycin 250mg (pack)"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cat-category">Category</Label>
                <Input
                  id="cat-category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="e.g. Antibiotic"
                  list="cat-category-options"
                />
                <datalist id="cat-category-options">
                  {categories.filter((c) => c !== "All").map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cat-unit">Pack unit</Label>
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
                <Label htmlFor="cat-price">Shelf price (ZMW)</Label>
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
                <Label htmlFor="cat-stock">Opening stock</Label>
                <Input
                  id="cat-stock"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.openingStock}
                  onChange={(e) => setForm({ ...form, openingStock: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cat-store">Opening stock destination</Label>
              <Select value={form.storeId || mainStore?.id || "st-main"} onValueChange={(v) => setForm({ ...form, storeId: v })}>
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
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cat-note">Shelf note (optional)</Label>
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
                <Label htmlFor="cat-rx" className="text-[13.5px]">
                  Prescription only
                </Label>
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
    </div>
  );
}
