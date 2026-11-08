"use client";

import { motion } from "framer-motion";
import {
  Banknote,
  Check,
  CheckCircle2,
  CreditCard,
  Minus,
  Plus,
  Receipt,
  Search,
  SearchX,
  ShoppingCart,
  Smartphone,
  Store,
  Trash2,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatZMW,
  loadCatalogue,
  loadInventory,
  loadSales,
  nextId,
  resolveStoreId,
  saveInventory,
  saveSales,
  stockForProduct,
  type CatalogueProduct,
  type InventoryItem,
  type PharmacyStore,
  type POSPaymentMethod,
  type POSSale,
} from "@/components/pharmacy/pharmacy-data";
import {
  PageHeader,
  pharmacyCardCls,
  brandBtnCls,
} from "@/components/pharmacy/pharmacy-shared";
import { recordAudit } from "@/lib/audit-log";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/* Point of Sale — search, tap, charge                                 */
/* ------------------------------------------------------------------ */
/* The counter is built for speed: the search box is pre-focused,      */
/* tapping a tile adds it to the sale, and one big charge button takes */
/* payment in cash, mobile money or card. Every completed sale         */
/* decrements the shelves, leaves an audit entry and feeds the         */
/* dashboard's sell-through — the whole flow lands well under 2 min.   */

type CartLine = { product: CatalogueProduct; qty: number };

const PAYMENT_METHODS: { id: POSPaymentMethod; label: string; icon: LucideIcon }[] = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "mobile", label: "Mobile", icon: Smartphone },
  { id: "card", label: "Card", icon: CreditCard },
];

const DISCOUNT_CHIPS = [0, 5, 10];

/** Cash notes a Zambian counter keeps in the till. */
const CASH_NOTES = [10, 20, 50, 100, 200];

export function PharmacyPOS({
  storeId = "all",
  stores,
}: {
  storeId?: string;
  stores: PharmacyStore[];
}) {
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueProduct[]>([]);
  const [sales, setSales] = useState<POSSale[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [method, setMethod] = useState<POSPaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  const [receipt, setReceipt] = useState<POSSale | null>(null);
  const [actor, setActor] = useState({ name: "", email: "" });
  // Hides the mobile review bar once the payment panel itself is on screen.
  const [cartInView, setCartInView] = useState(false);
  const cartRef = useRef<HTMLElement>(null);

  // Restore the shelves, the catalogue, the day's sales + the identity.
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
      setItems(loadInventory());
      setCatalogue(loadCatalogue());
      setSales(loadSales());
      setHydrated(true);
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // "/" anywhere jumps to the search box — the counter never waits for a mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Track whether the payment panel is already on screen (mobile review bar).
  useEffect(() => {
    const el = cartRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCartInView(entry.isIntersecting), {
      threshold: 0.2,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The counter sells where the store view points; "all" sells at the main store.
  const sellingStore = useMemo(() => {
    if (storeId !== "all") return stores.find((store) => store.id === storeId);
    return stores.find((store) => store.isMain) ?? stores[0];
  }, [storeId, stores]);

  const sellingStoreId = sellingStore?.id ?? "st-main";

  /**
   * Shelf stock of a product at this counter. The "All stores" counter pools
   * every storefront's stock (fulfilling from the counter's store first),
   * while a scoped counter sells only that store's shelves.
   */
  const scopeAll = storeId === "all";
  const stockOf = (name: string) => stockForProduct(name, items, scopeAll ? "all" : sellingStoreId);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(catalogue.map((product) => product.category))).sort()],
    [catalogue]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogue.filter((product) => {
      const matchesQuery = !q || product.name.toLowerCase().includes(q) || product.category.toLowerCase().includes(q);
      const matchesCategory = category === "All" || product.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [catalogue, query, category]);

  const addToCart = (product: CatalogueProduct) => {
    if (!hydrated) return;
    const available = stockOf(product.name);
    const inCart = cart.find((line) => line.product.id === product.id)?.qty ?? 0;
    if (inCart >= available) {
      toast({
        title: available === 0 ? `${product.name} is out of stock here` : `Only ${available} on the shelf`,
        description: "Restock via a purchase order or stock request.",
      });
      return;
    }
    setCart((prev) => {
      const existing = prev.find((line) => line.product.id === product.id);
      if (existing) {
        return prev.map((line) =>
          line.product.id === product.id ? { ...line, qty: line.qty + 1 } : line
        );
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const setQty = (productId: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.product.id !== productId) return line;
          const available = stockOf(line.product.name);
          return { ...line, qty: Math.max(0, Math.min(qty, available)) };
        })
        .filter((line) => line.qty > 0)
    );
  };

  const removeLine = (productId: string) => {
    setCart((prev) => prev.filter((line) => line.product.id !== productId));
  };

  const clearSale = () => {
    setCart([]);
    setDiscountPct(0);
    setTendered("");
  };

  const subtotal = cart.reduce((acc, line) => acc + line.qty * line.product.price, 0);
  const discount = Math.round((subtotal * discountPct) / 100);
  const total = Math.max(0, subtotal - discount);
  const tenderedNum = Number.parseFloat(tendered) || 0;
  const changeDue = tenderedNum - total;
  const cashShort = method === "cash" && tenderedNum < total;
  const canCharge = hydrated && cart.length > 0 && total > 0 && !cashShort;

  const quickTenders = useMemo(() => {
    if (total <= 0) return [];
    const options = new Set<number>([total]);
    for (const note of CASH_NOTES) if (note >= total) options.add(note);
    return Array.from(options).sort((a, b) => a - b).slice(0, 5);
  }, [total]);

  // Today's counter performance at this store.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todaysSales = sales.filter(
    (sale) => sale.soldAt >= startOfToday.getTime() && resolveStoreId(sale) === sellingStoreId
  );
  const todayItems = todaysSales.reduce((acc, sale) => acc + sale.lines.reduce((a, l) => a + l.qty, 0), 0);
  const todayRevenue = todaysSales.reduce((acc, sale) => acc + sale.total, 0);
  const avgBasket = todaysSales.length > 0 ? Math.round(todayRevenue / todaysSales.length) : 0;

  const completeSale = () => {
    if (!canCharge || !sellingStore) return;

    const sale: POSSale = {
      id: nextId(sales, "SALE"),
      lines: cart.map((line) => ({
        productId: line.product.id,
        name: line.product.name,
        qty: line.qty,
        unitPrice: line.product.price,
      })),
      subtotal,
      discount,
      total,
      method,
      ...(method === "cash" ? { tendered: tenderedNum, change: changeDue } : {}),
      soldAt: Date.now(),
      storeId: sellingStore.id,
      servedBy: actor.name || "Front counter",
    };

    // Walk the shelves: take each line's quantity, preferring this counter's
    // store, then spilling to the other branches when the view pools stock.
    const next = items.map((row) => ({ ...row }));
    for (const line of sale.lines) {
      let remaining = line.qty;
      const rows = next
        .filter(
          (row) => row.name === line.name && (scopeAll || resolveStoreId(row) === sellingStoreId)
        )
        .sort(
          (a, b) =>
            Number(resolveStoreId(b) === sellingStoreId) - Number(resolveStoreId(a) === sellingStoreId)
        );
      for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(row.qty, remaining);
        row.qty -= take;
        remaining -= take;
      }
    }
    setItems(next);
    saveInventory(next);

    const nextSales = [sale, ...sales];
    setSales(nextSales);
    saveSales(nextSales);

    if (actor.email) {
      recordAudit({
        title: "POS Sale Completed",
        action: "Update",
        detail: `${sale.id} · ${sale.lines.reduce((a, l) => a + l.qty, 0)} items · ${formatZMW(sale.total)}`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_pos_sale", { items: sale.lines.length, total: sale.total, method });

    setReceipt(sale);
    clearSale();
  };

  const methodLabel = PAYMENT_METHODS.find((m) => m.id === method)?.label ?? "";

  const TodayStat = ({ value, label }: { value: string; label: string }) => (
    <div className="flex flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
      <p className="text-[18px] font-bold leading-none tracking-tight tabular-nums">{value}</p>
      <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );

  return (
    <div aria-labelledby="pharmacy-pos-title" className={cn(cart.length > 0 && "pb-20 lg:pb-0")}>
      <PageHeader
        icon={ShoppingCart}
        title="Point of Sale"
        subtitle="Search, tap, charge — a complete checkout in under two minutes"
        actions={
          sellingStore ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1.5 text-[12px] font-semibold text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
              <Store className="h-3.5 w-3.5" aria-hidden="true" />
              Selling at {sellingStore.name}
            </span>
          ) : undefined
        }
      />
      <h2 id="pharmacy-pos-title" className="sr-only">
        Point of Sale
      </h2>

      {/* Today at this counter */}
      <div className={cn(pharmacyCardCls, "mt-5 grid grid-cols-2 gap-3 p-4 sm:grid-cols-4")}>
        <TodayStat value={String(hydrated ? todaysSales.length : "—")} label="Sales today" />
        <TodayStat value={String(hydrated ? todayItems : "—")} label="Items sold" />
        <TodayStat value={hydrated ? formatZMW(todayRevenue) : "—"} label="Revenue today" />
        <TodayStat value={hydrated ? formatZMW(avgBasket) : "—"} label="Avg. basket" />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
        {/* ------------------------------------------------ products */}
        <section aria-label="Products">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length > 0) {
                  e.preventDefault();
                  addToCart(filtered[0]);
                  setQuery("");
                }
              }}
              placeholder="Search products or scan a barcode…  ( / )"
              aria-label="Search products"
              autoComplete="off"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-[14px] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          {/* Category chips */}
          <div className="pulse-scroll mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Product categories">
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
                </button>
              );
            })}
          </div>

          {/* Product tiles */}
          {filtered.length === 0 ? (
            <div className={cn(pharmacyCardCls, "mt-3 flex min-h-[160px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center")}>
              <SearchX className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
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
                Clear search
              </button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((product) => {
                const stock = stockOf(product.name);
                const out = stock <= 0;
                const low = !out && stock <= 10;
                const inCart = cart.find((line) => line.product.id === product.id)?.qty ?? 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addToCart(product)}
                    disabled={out}
                    aria-label={`Add ${product.name}, ${formatZMW(product.price)}${out ? ", out of stock" : `, ${stock} in stock`}`}
                    className={cn(
                      "group relative flex flex-col rounded-xl border bg-white p-3.5 text-left transition-all dark:bg-white/[0.045]",
                      out
                        ? "cursor-not-allowed border-slate-100 opacity-55 dark:border-white/5"
                        : "border-slate-200 hover:-translate-y-0.5 hover:border-purple-300 hover:shadow-[0_12px_28px_-14px_rgba(147,51,234,0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:hover:border-purple-500/40"
                    )}
                  >
                    {product.prescription && (
                      <span
                        title="Prescription only"
                        className="absolute right-2.5 top-2.5 flex h-5 items-center rounded-md bg-rose-100 px-1.5 text-[10px] font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                      >
                        Rx
                      </span>
                    )}
                    {inCart > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 px-1.5 text-[11px] font-bold text-white shadow-[0_4px_10px_-3px_rgba(147,51,234,0.8)]">
                        {inCart}
                      </span>
                    )}
                    <p className="line-clamp-2 min-h-[2.4em] text-[13px] font-semibold leading-snug text-slate-900 dark:text-white">
                      {product.name}
                    </p>
                    <p className="mt-1 text-[11.5px] text-slate-400 dark:text-slate-500">
                      {product.category} · per {product.unit}
                    </p>
                    <div className="mt-auto flex items-end justify-between pt-2.5">
                      <span className="text-[15px] font-bold tracking-tight text-purple-700 dark:text-purple-300">
                        {formatZMW(product.price)}
                      </span>
                      <span
                        className={cn(
                          "text-[11px] font-semibold tabular-nums",
                          out
                            ? "text-rose-500 dark:text-rose-400"
                            : low
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-slate-400 dark:text-slate-500"
                        )}
                      >
                        {out ? "Out" : low ? `${stock} low` : `${stock} left`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ------------------------------------------------ cart */}
        <section
          id="pos-cart"
          ref={cartRef}
          aria-label="Current sale"
          className="w-full scroll-mt-20 lg:sticky lg:top-20"
        >
          <div className={cn(pharmacyCardCls, "overflow-hidden")}>
            {/* Cart header */}
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4 dark:border-white/5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
                <ShoppingCart className="h-4.5 w-4.5" strokeWidth={2.1} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-bold leading-tight">Current sale</p>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  {cart.length === 0
                    ? "Nothing rung up yet"
                    : `${cart.reduce((acc, line) => acc + line.qty, 0)} item${cart.reduce((acc, line) => acc + line.qty, 0) === 1 ? "" : "s"} on the counter`}
                </p>
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={clearSale}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear
                </button>
              )}
            </div>

            {/* Lines */}
            {cart.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-5 py-9 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-50 dark:bg-white/5">
                  <Receipt className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden="true" />
                </span>
                <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
                  Tap a product or search to start a sale.
                </p>
                <p className="text-[11.5px] text-slate-400 dark:text-slate-500">
                  Press <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans text-[10px] font-semibold dark:border-white/10 dark:bg-white/10">/</kbd> to jump
                  to search · <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans text-[10px] font-semibold dark:border-white/10 dark:bg-white/10">Enter</kbd> adds
                  the first match
                </p>
              </div>
            ) : (
              <ul className="pulse-scroll max-h-[280px] divide-y divide-slate-100 overflow-y-auto dark:divide-white/5">
                {cart.map((line) => (
                  <li key={line.product.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">
                        {line.product.name}
                      </p>
                      <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                        {formatZMW(line.product.price)} × {line.qty}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`One less ${line.product.name}`}
                        onClick={() => setQty(line.product.id, line.qty - 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                      >
                        <Minus className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <span className="w-7 text-center text-[13px] font-bold tabular-nums">{line.qty}</span>
                      <button
                        type="button"
                        aria-label={`One more ${line.product.name}`}
                        onClick={() => setQty(line.product.id, line.qty + 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-purple-50 hover:text-purple-600 dark:border-white/10 dark:text-slate-300 dark:hover:bg-purple-500/15"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                    <span className="w-[64px] shrink-0 text-right text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatZMW(line.qty * line.product.price)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Discount + totals + payment */}
            <div className="border-t border-slate-100 px-5 py-4 dark:border-white/5">
              {/* Discount */}
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">Discount</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {DISCOUNT_CHIPS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      aria-pressed={discountPct === pct}
                      onClick={() => setDiscountPct(pct)}
                      className={cn(
                        "h-7 rounded-md px-2.5 text-[11.5px] font-bold transition-colors",
                        discountPct === pct
                          ? "bg-purple-600 text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-purple-100 hover:text-purple-700 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-purple-500/20"
                      )}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <dt>Subtotal</dt>
                  <dd className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatZMW(subtotal)}</dd>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-purple-600 dark:text-purple-400">
                    <dt>Discount ({discountPct}%)</dt>
                    <dd className="font-semibold tabular-nums">− {formatZMW(discount)}</dd>
                  </div>
                )}
                <div className="mt-1 flex items-baseline justify-between border-t border-dashed border-slate-200 pt-2.5 dark:border-white/10">
                  <dt className="text-[13.5px] font-bold">Total</dt>
                  <dd className="text-[22px] font-bold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">
                    {formatZMW(total)}
                  </dd>
                </div>
              </dl>

              {/* Payment method */}
              <div
                role="radiogroup"
                aria-label="Payment method"
                className="mt-4 grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-white/5"
              >
                {PAYMENT_METHODS.map(({ id, label, icon: Icon }) => {
                  const active = method === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setMethod(id)}
                      className={cn(
                        "flex h-9 items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-bold transition-all",
                        active
                          ? "bg-white text-purple-700 shadow-sm dark:bg-purple-500/25 dark:text-white"
                          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Cash tendered */}
              {method === "cash" && cart.length > 0 && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-1.5">
                    {quickTenders.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setTendered(String(amount))}
                        className={cn(
                          "h-7 rounded-md px-2.5 text-[11.5px] font-bold transition-colors",
                          tenderedNum === amount
                            ? "bg-purple-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-purple-100 hover:text-purple-700 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-purple-500/20"
                        )}
                      >
                        {amount === total ? "Exact" : `K ${amount}`}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-slate-400">
                        K
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={tendered}
                        onChange={(e) => setTendered(e.target.value)}
                        placeholder="Cash tendered"
                        aria-label="Cash tendered"
                        className={cn(
                          "h-10 w-full rounded-md border bg-white pl-8 pr-3 text-[13.5px] font-semibold tabular-nums outline-none transition-[border-color,box-shadow] placeholder:font-normal placeholder:text-slate-400 focus:ring-4 dark:bg-white/5 dark:text-white",
                          cashShort
                            ? "border-rose-300 focus:border-rose-400 focus:ring-rose-500/15 dark:border-rose-500/40"
                            : "border-slate-200 focus:border-purple-400 focus:ring-purple-500/15 dark:border-white/10"
                        )}
                      />
                    </div>
                    <div className="min-w-[92px] text-right">
                      {tenderedNum > 0 ? (
                        cashShort ? (
                          <p className="text-[11.5px] font-semibold leading-tight text-rose-500 dark:text-rose-400">
                            {formatZMW(total - tenderedNum)} still owed
                          </p>
                        ) : (
                          <p className="text-[11.5px] font-semibold leading-tight text-emerald-600 dark:text-emerald-400">
                            Change {formatZMW(changeDue)}
                          </p>
                        )
                      ) : (
                        <p className="text-[11.5px] text-slate-400 dark:text-slate-500">Tendered</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Charge */}
              <button
                type="button"
                onClick={completeSale}
                disabled={!canCharge}
                className={cn(
                  brandBtnCls,
                  "mt-4 h-12 w-full text-[15px] font-bold disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                )}
              >
                {cart.length === 0 ? (
                  <>
                    <ShoppingCart className="h-[18px] w-[18px]" aria-hidden="true" />
                    Charge — add items first
                  </>
                ) : cashShort ? (
                  <>
                    <TriangleAlert className="h-[18px] w-[18px]" aria-hidden="true" />
                    {formatZMW(total - tenderedNum)} still owed
                  </>
                ) : (
                  <>
                    <Zap className="h-[18px] w-[18px]" aria-hidden="true" />
                    Charge {formatZMW(total)} · {methodLabel}
                  </>
                )}
              </button>
              {cart.length > 0 && (
                <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
                  Stock and the day's totals update the moment the sale lands.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Mobile review bar — one thumb tap jumps to the payment panel */}
      {cart.length > 0 && !cartInView && (
        <div className="fixed inset-x-3 bottom-3 z-40 lg:hidden">
          <button
            type="button"
            onClick={() =>
              document.getElementById("pos-cart")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className={cn(brandBtnCls, "h-13 w-full py-3.5 text-[15px] font-bold shadow-2xl")}
          >
            <ShoppingCart className="h-[18px] w-[18px]" aria-hidden="true" />
            Review sale · {formatZMW(total)} · {cart.reduce((acc, line) => acc + line.qty, 0)} item
            {cart.reduce((acc, line) => acc + line.qty, 0) === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {/* Receipt */}
      <Dialog open={receipt !== null} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent className="max-w-sm p-0 outline-none sm:max-w-sm">
          {receipt && (
            <div className="flex flex-col items-center px-6 pb-6 pt-8">
              <motion.span
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 320, damping: 18 }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
              >
                <Check className="h-7 w-7" strokeWidth={2.6} aria-hidden="true" />
              </motion.span>
              <DialogHeader className="mt-3 items-center space-y-1 text-center">
                <DialogTitle className="text-[18px] font-bold tracking-tight">Sale complete</DialogTitle>
                <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
                  {receipt.id} · served by {receipt.servedBy}
                </p>
              </DialogHeader>

              {receipt.method === "cash" && (receipt.change ?? 0) > 0 && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3.5 py-1.5 text-[13px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <Banknote className="h-4 w-4" aria-hidden="true" />
                  Change due {formatZMW(receipt.change ?? 0)}
                </p>
              )}

              {/* The slip */}
              <div className="mt-4 w-full rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-4 font-mono text-[11.5px] leading-relaxed text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-300">
                <p className="text-center font-bold tracking-wide text-slate-900 dark:text-white">
                  {sellingStore?.name ?? "Pulse Pharmacy"}
                </p>
                <p className="text-center text-[10.5px] text-slate-400 dark:text-slate-500">
                  {new Date(receipt.soldAt).toLocaleString("en-US", {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
                <div className="my-2.5 border-t border-dashed border-slate-300 dark:border-white/15" />
                <ul className="flex flex-col gap-1">
                  {receipt.lines.map((line) => (
                    <li key={line.productId} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {line.name} ×{line.qty}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatZMW(line.qty * line.unitPrice)}</span>
                    </li>
                  ))}
                </ul>
                <div className="my-2.5 border-t border-dashed border-slate-300 dark:border-white/15" />
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatZMW(receipt.subtotal)}</span>
                </div>
                {receipt.discount > 0 && (
                  <div className="flex justify-between">
                    <span>Discount</span>
                    <span className="tabular-nums">−{formatZMW(receipt.discount)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between text-[13px] font-bold text-slate-900 dark:text-white">
                  <span>TOTAL</span>
                  <span className="tabular-nums">{formatZMW(receipt.total)}</span>
                </div>
                <div className="mt-1 flex justify-between capitalize">
                  <span>Paid · {receipt.method === "mobile" ? "mobile money" : receipt.method}</span>
                  <span className="tabular-nums">
                    {receipt.method === "cash" && receipt.tendered ? formatZMW(receipt.tendered) : receipt.method === "cash" ? "—" : "✓"}
                  </span>
                </div>
                {receipt.method === "cash" && (
                  <div className="flex justify-between">
                    <span>Change</span>
                    <span className="tabular-nums">{formatZMW(receipt.change ?? 0)}</span>
                  </div>
                )}
                <div className="my-2.5 border-t border-dashed border-slate-300 dark:border-white/15" />
                <p className="text-center text-[10.5px] text-slate-400 dark:text-slate-500">
                  Karibuni — thank you for choosing Pulse
                </p>
              </div>

              <div className="mt-5 flex w-full items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setReceipt(null);
                    requestAnimationFrame(() => searchRef.current?.focus());
                  }}
                  className={cn(brandBtnCls, "h-11 flex-1 text-[13.5px] font-bold")}
                >
                  <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                  New sale
                </button>
                <button
                  type="button"
                  onClick={() => setReceipt(null)}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white text-[13.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/5"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Done
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
