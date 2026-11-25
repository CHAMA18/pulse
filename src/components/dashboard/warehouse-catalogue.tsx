"use client";

import { motion } from "framer-motion";
import { Check, ChevronsUpDown, Loader2, PackagePlus, Plus, Search, Warehouse } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  loadWarehouseItems,
  loadWarehouseMovements,
  nextWarehouseMovementId,
  saveWarehouseItems,
  saveWarehouseMovements,
  WAREHOUSE_NAME,
  type WarehouseItem,
} from "@/lib/warehouse";
import { cn } from "@/lib/utils";
import { PRODUCT_CATEGORIES } from "@/lib/product-categories";
import { DUNIYA_MARKUP_PERCENT, duniyaUnitPrice, formatZmw } from "@/lib/pricing";
import { ensureMedicalProductSearchIndex, listMedicalProducts, registerMedicalProduct, type MedicalProduct } from "@/lib/cloud/medical-products";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/* ------------------------------------------------------------------ */
/* Warehouse Catalogue — Pulse Central Warehouse shelves. Quantities    */
/* share one store with the Stock Movements ledger (src/lib/warehouse)  */
/* so this page and Stock Movements always agree.                       */
/* ------------------------------------------------------------------ */

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";
const inputCls =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[13.5px] outline-none placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white";

export function WarehouseCatalogue() {
  const { toast } = useToast();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<"all" | "available" | "low" | "out">("all");
  const [medicalProducts, setMedicalProducts] = useState<MedicalProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [productsCursor, setProductsCursor] = useState<string | null>(null);
  const [productsError, setProductsError] = useState("");
  const [searchIndexReady, setSearchIndexReady] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [registeringProduct, setRegisteringProduct] = useState(false);
  const [form, setForm] = useState({ productId: "", name: "", category: "General", qty: "", unitPrice: "", batch: "", expiry: "" });

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setItems(loadWarehouseItems());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!receiveOpen) return;
    let active = true;
    setProductsLoading(true);
    setProductsError("");
    void ensureMedicalProductSearchIndex()
      .then(() => {
        if (active) setSearchIndexReady(true);
      })
      .catch((error: unknown) => {
        if (active) setProductsError(error instanceof Error ? error.message : "The searchable product register could not be prepared.");
      })
      .finally(() => {
        if (active) setProductsLoading(false);
      });
    return () => { active = false; };
  }, [receiveOpen]);

  useEffect(() => {
    if (!receiveOpen || !searchIndexReady) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setProductsLoading(true);
      setProductsError("");
      void listMedicalProducts(productQuery)
        .then((page) => {
          if (!active) return;
          setMedicalProducts(page.products.sort((a, b) => a.name.localeCompare(b.name)));
          setProductsCursor(page.nextCursor);
        })
        .catch((error: unknown) => {
          if (active) setProductsError(error instanceof Error ? error.message : "The medical product register could not be loaded.");
        })
        .finally(() => {
          if (active) setProductsLoading(false);
        });
    }, productQuery ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [receiveOpen, productQuery, searchIndexReady]);

  const loadMoreMedicalProducts = async () => {
    if (!productsCursor || loadingMoreProducts) return;
    setLoadingMoreProducts(true);
    try {
      const page = await listMedicalProducts(productQuery, productsCursor);
      setMedicalProducts((current) => {
        const byId = new Map(current.map((product) => [product.id, product]));
        for (const product of page.products) byId.set(product.id, product);
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
      setProductsCursor(page.nextCursor);
    } catch (error) {
      toast({ title: "More products could not be loaded", description: error instanceof Error ? error.message : "Try again in a moment.", variant: "destructive" });
    } finally {
      setLoadingMoreProducts(false);
    }
  };

  const persist = (next: WarehouseItem[]) => {
    setItems(next);
    saveWarehouseItems(next);
  };

  const recordMovement = (item: WarehouseItem, qty: number, reason: string) => {
    const movements = loadWarehouseMovements();
    saveWarehouseMovements([
      {
        id: nextWarehouseMovementId(movements),
        at: Date.now(),
        type: qty >= 0 ? ("receipt" as const) : ("adjustment" as const),
        itemId: item.id,
        productName: item.name,
        batch: item.batch,
        qty,
        reason,
        actor: { name: "Pulse warehouse", email: "" },
      },
      ...movements,
    ]);
  };

  const categoryOptions = useMemo(() => {
    const existing = items.map((item) => item.category).filter(Boolean);
    return Array.from(new Set<string>([...PRODUCT_CATEGORIES, ...existing, ...medicalProducts.map((product) => product.category)])).sort((a, b) => a.localeCompare(b));
  }, [items, medicalProducts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((item) => {
        if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
        if (stockFilter === "available" && item.qty <= item.reorderLevel) return false;
        if (stockFilter === "low" && (item.qty <= 0 || item.qty > item.reorderLevel)) return false;
        if (stockFilter === "out" && item.qty > 0) return false;
        if (!q) return true;
        return `${item.name} ${item.category} ${item.batch}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, query, categoryFilter, stockFilter]);

  const units = items.reduce((acc, item) => acc + item.qty, 0);
  const costValue = items.reduce((acc, item) => acc + item.qty * item.unitPrice, 0);
  const duniyaValue = items.reduce(
    (acc, item) => acc + item.qty * duniyaUnitPrice(item.unitPrice, item.markupPercent),
    0
  );
  const low = items.filter((item) => item.qty <= item.reorderLevel);
  const formDuniya = duniyaUnitPrice(Number(form.unitPrice) || 0, DUNIYA_MARKUP_PERCENT);

  const addItem = () => {
    const qty = Math.max(0, Math.round(Number(form.qty) || 0));
    if (!form.productId) {
      toast({ title: "Choose a registered product", description: "Search the register or add a new product to it first." });
      return;
    }
    if (form.name.trim().length < 2 || qty < 1) {
      toast({ title: "Almost there", description: "Choose a product and enter at least one unit." });
      return;
    }
    const name = form.name.trim();
    const batch = form.batch.trim() || `WH-${new Date().getFullYear()}`;
    const existing = items.find(
      (row) => row.name.toLowerCase() === name.toLowerCase() && row.batch === batch
    );
    const item: WarehouseItem = existing ?? {
      id: `wh-${Date.now().toString(36)}`,
      productId: form.productId,
      name,
      category: form.category.trim() || "General",
      batch,
      expiry: form.expiry || new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      qty,
      reorderLevel: Math.max(1, Math.round(qty * 0.25)),
      unitPrice: Math.max(0, Number(form.unitPrice) || 0),
      markupPercent: DUNIYA_MARKUP_PERCENT,
    };
    persist(
      existing
        ? items.map((row) =>
            row.id === item.id
              ? {
                  ...row,
                  productId: row.productId ?? form.productId,
                  qty: row.qty + qty,
                  unitPrice: item.unitPrice,
                  markupPercent: DUNIYA_MARKUP_PERCENT,
                }
              : row
          )
        : [item, ...items]
    );
    recordMovement(item, qty, "Supplier delivery");
    setForm({ productId: "", name: "", category: "General", qty: "", unitPrice: "", batch: "", expiry: "" });
    setProductQuery("");
    setReceiveOpen(false);
    toast({ title: "Added to warehouse", description: `${name} × ${qty} is on the hub shelves — receipt recorded in Stock Movements.` });
  };

  const selectMedicalProduct = (product: MedicalProduct) => {
    setForm((current) => ({ ...current, productId: product.id, name: product.name, category: product.category }));
    setProductQuery("");
    setProductPickerOpen(false);
  };

  const exactProductMatch = medicalProducts.some(
    (product) => product.normalizedName === productQuery.trim().replace(/\s+/g, " ").normalize("NFKC").toLocaleLowerCase("en-US")
  );

  const registerSearchedProduct = async () => {
    const name = productQuery.trim().replace(/\s+/g, " ");
    if (name.length < 2) return;
    setRegisteringProduct(true);
    try {
      const result = await registerMedicalProduct({ name, category: form.category });
      setMedicalProducts((current) => [...current.filter((product) => product.id !== result.product.id), result.product].sort((a, b) => a.name.localeCompare(b.name)));
      selectMedicalProduct(result.product);
      toast({
        title: result.created ? "Product added to the medical register" : "Product already registered",
        description: `${result.product.name} is selected for this warehouse entry.`,
      });
    } catch (error) {
      toast({ title: "Product could not be registered", description: error instanceof Error ? error.message : "Try again when the register is available.", variant: "destructive" });
    } finally {
      setRegisteringProduct(false);
    }
  };

  return (
    <div className="space-y-7" data-tour="pulse-warehouse">
      <div>
        <h2 className="text-[26px] font-bold tracking-tight text-slate-900 dark:text-white">Warehouse Catalogue</h2>
        <p className="mt-1 text-[14px] text-slate-500 dark:text-slate-400">
          Stock held at {WAREHOUSE_NAME} — the hub Pulse issues to the network from.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setReceiveOpen(true)}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-shadow hover:shadow-[0_12px_26px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          >
            <PackagePlus className="h-4 w-4" aria-hidden="true" />
            Add products
          </button>
          <span className="text-[12.5px] text-slate-500 dark:text-slate-400">
            Add a new product, or book more units of a batch already on the shelves.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-5">
        {[
          { label: "Products", value: hydrated ? String(items.length) : "—", desc: "Lines in the warehouse" },
          { label: "Units on hand", value: hydrated ? units.toLocaleString() : "—", desc: "Across every batch" },
          { label: "Cost value", value: hydrated ? formatZmw(costValue) : "—", desc: "What Duniya paid suppliers" },
          { label: "Duniya value", value: hydrated ? formatZmw(duniyaValue) : "—", desc: `Cost + ${DUNIYA_MARKUP_PERCENT}% markup` },
          { label: "Low stock", value: hydrated ? String(low.length) : "—", desc: "At or below reorder level" },
        ].map((card) => (
          <div key={card.label} className={cn(cardCls, "p-5")}>
            <p className="text-2xl font-bold leading-none tracking-tight">{card.value}</p>
            <p className="mt-2 text-[15px] font-semibold leading-none">{card.label}</p>
            <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">{card.desc}</p>
          </div>
        ))}
      </div>

      <div className={cn(cardCls, "overflow-hidden")}>
        <div className="flex flex-wrap items-center gap-3 p-5 pb-3">
          <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">On the shelves</h3>
          <label className="relative ml-auto block w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search warehouse…" aria-label="Search warehouse" className={cn(inputCls, "pl-9")} />
          </label>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter warehouse by category" className={cn(inputCls, "w-auto min-w-[170px]")}>
            <option value="all">All categories</option>
            {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)} aria-label="Filter warehouse by stock level" className={cn(inputCls, "w-auto min-w-[170px]")}>
            <option value="all">All stock levels</option>
            <option value="available">Available</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          <span className="text-[12px] text-slate-500 dark:text-slate-400" aria-live="polite">{filtered.length} of {items.length} batches</span>
        </div>
        {filtered.length === 0 ? (
          <p className="px-5 pb-6 text-[13.5px] text-slate-500 dark:text-slate-400">
            {items.length === 0 ? "The warehouse is empty — receive your first stock above." : "Nothing matches these filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13.5px]">
              <thead>
                <tr className="border-y border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                  <th className="px-5 py-3 font-semibold">Product</th>
                  <th className="px-3 py-3 font-semibold">Batch</th>
                  <th className="px-3 py-3 font-semibold">Expiry</th>
                  <th className="px-3 py-3 text-right font-semibold">Qty</th>
                  <th className="px-3 py-3 text-right font-semibold">Cost</th>
                  <th className="px-3 py-3 text-right font-semibold">Duniya</th>
                  <th className="px-5 py-3 text-right font-semibold">Duniya value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-900 dark:text-white">{item.name}</p>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">{item.category}</p>
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px]">{item.batch}</td>
                    <td className="px-3 py-3">{item.expiry}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums">
                      {item.qty}
                      {item.qty <= item.reorderLevel && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Low</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatZmw(item.unitPrice)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-purple-700 dark:text-purple-300">{formatZmw(duniyaUnitPrice(item.unitPrice, item.markupPercent))}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {formatZmw(item.qty * duniyaUnitPrice(item.unitPrice, item.markupPercent))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[12px] text-slate-400 dark:text-slate-500">
        Warehouse quantities are read-only here — adjustments are recorded in Stock Movement so the
        ledger stays auditable. Pharmacy shelves live under Pharmacies Inventory.
      </motion.p>

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="rounded-2xl p-6 sm:max-w-[520px]">
          <DialogHeader className="space-y-1.5 text-left sm:text-left">
            <DialogTitle className="flex items-center gap-2 text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
              <Warehouse className="h-5 w-5 text-purple-600" aria-hidden="true" />
              Add products
            </DialogTitle>
            <DialogDescription className="text-[13.5px] text-slate-500 dark:text-slate-400">
              Add stock to {WAREHOUSE_NAME}. It lands on the hub shelves immediately and is
              recorded as a receipt in Stock Movements.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Medical product</label>
              <Popover open={productPickerOpen} onOpenChange={setProductPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="combobox"
                    aria-expanded={productPickerOpen}
                    aria-label="Search registered medical products"
                    className={cn(inputCls, "flex w-full items-center justify-between gap-3 text-left")}
                  >
                    <span className={cn("truncate", !form.name && "text-slate-400")}>
                      {form.name || "Search the medical product register…"}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                  <Command shouldFilter={false}>
                    <CommandInput
                      value={productQuery}
                      onValueChange={setProductQuery}
                      placeholder="Search by medicine, word, or strength…"
                      disabled={productsLoading || loadingMoreProducts || registeringProduct}
                    />
                    <CommandList>
                      {productsLoading ? (
                        <div className="flex items-center justify-center gap-2 px-4 py-6 text-[13px] text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          {searchIndexReady ? "Loading product register…" : "Preparing searchable product register…"}
                        </div>
                      ) : productsError ? (
                        <div className="px-4 py-5 text-center text-[12.5px] text-rose-600 dark:text-rose-300">
                          {productsError}<br />Close and reopen this form to retry.
                        </div>
                      ) : (
                        <>
                          <CommandEmpty>{productQuery.trim().length < 2 ? "Type a product name to search the register." : "No registered product matches this search."}</CommandEmpty>
                          <CommandGroup heading="Medical product register">
                            {medicalProducts.map((product) => (
                              <CommandItem
                                key={product.id}
                                value={`${product.name} ${product.category}`}
                                onSelect={() => selectMedicalProduct(product)}
                              >
                                <Check className={cn("h-4 w-4", form.productId === product.id ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate">{product.name}</span>
                                <span className="text-[11px] text-slate-400">{product.category}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
                      )}
                    </CommandList>
                    {productsCursor && !productsLoading && !productsError && (
                      <div className="border-t border-slate-100 p-2 dark:border-white/10">
                        <button
                          type="button"
                          onClick={() => void loadMoreMedicalProducts()}
                          disabled={loadingMoreProducts}
                          className="flex h-9 w-full items-center justify-center gap-2 rounded-md px-2 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-white/5"
                        >
                          {loadingMoreProducts && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                          {loadingMoreProducts ? "Loading more products…" : "Load more products"}
                        </button>
                      </div>
                    )}
                    {!productsLoading && !productsError && productQuery.trim().length >= 2 && !exactProductMatch && (
                      <div className="border-t border-slate-100 p-2 dark:border-white/10">
                        <p className="px-2 pb-1 text-[11.5px] text-slate-500 dark:text-slate-400">Not registered? Add it to the shared product register first.</p>
                        <button
                          type="button"
                          disabled={registeringProduct}
                          onClick={() => void registerSearchedProduct()}
                          className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-60 dark:text-purple-300 dark:hover:bg-white/5"
                        >
                          {registeringProduct ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                          Register “{productQuery.trim()}” as {form.category}
                        </button>
                      </div>
                    )}
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="mt-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
                Select from the shared register, or add a missing product before entering its batch details.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="wh-category" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Category</label>
                <select id="wh-category" value={form.category} disabled={Boolean(form.productId)} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={cn(inputCls, "disabled:opacity-60")}>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="wh-batch" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Batch</label>
                <input id="wh-batch" value={form.batch} onChange={(e) => setForm((f) => ({ ...f, batch: e.target.value }))} placeholder="e.g. WH-2026-04" className={inputCls} />
              </div>
              <div>
                <label htmlFor="wh-qty" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Quantity</label>
                <input id="wh-qty" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} type="number" min={1} placeholder="e.g. 500" className={inputCls} />
              </div>
              <div>
                <label htmlFor="wh-cost" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Supplier cost / unit (ZMW)</label>
                <input id="wh-cost" value={form.unitPrice} onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))} type="number" min={0} placeholder="e.g. 12.50" className={inputCls} />
                <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                  Duniya price at +{DUNIYA_MARKUP_PERCENT}%:{" "}
                  <span className="font-semibold text-purple-700 dark:text-purple-300">{formatZmw(formDuniya)}</span>
                </p>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="wh-expiry" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">Expiry date</label>
                <input id="wh-expiry" value={form.expiry} onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))} type="date" className={inputCls} />
              </div>
            </div>
          </div>
          <DialogFooter className="mt-2 gap-2">
            <button type="button" onClick={() => setReceiveOpen(false)} className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">
              Cancel
            </button>
            <button type="button" onClick={addItem} className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500">
              <PackagePlus className="h-4 w-4" aria-hidden="true" />
              Add to warehouse
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
