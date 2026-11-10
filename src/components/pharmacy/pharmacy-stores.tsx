"use client";

import { motion } from "framer-motion";
import {
  Building2,
  MapPin,
  MoreHorizontal,
  Package,
  Pencil,
  Phone,
  Plus,
  Star,
  Store,
  Trash2,
  Warehouse,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatZMW,
  loadDeliveries,
  loadInventory,
  loadStockRequests,
  nextStoreId,
  resolveStoreId,
  type InventoryItem,
  type PharmacyStore,
} from "@/components/pharmacy/pharmacy-data";
import { PageHeader, pharmacyCardCls } from "@/components/pharmacy/pharmacy-shared";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ------------------------------------------------------------------ */
/* Store dialog                                                        */
/* ------------------------------------------------------------------ */

type StoreDraft = {
  name: string;
  location: string;
  address: string;
  phone: string;
};

function StoreDialog({
  open,
  onOpenChange,
  stores,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: PharmacyStore[];
  editing: PharmacyStore | null;
  onSaved: (draft: StoreDraft) => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<{ name?: string; location?: string }>({});

  // Reopening starts from the store being edited (render-time reset).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName(editing?.name ?? "");
      setLocation(editing?.location ?? "");
      setAddress(editing?.address ?? "");
      setPhone(editing?.phone ?? "");
      setErrors({});
    }
  }

  const submit = () => {
    const next: typeof errors = {};
    const cleanName = name.trim();
    const cleanLocation = location.trim();
    if (cleanName.length < 2) next.name = "Give the store a name.";
    else if (
      stores.some(
        (store) =>
          store.id !== editing?.id && store.name.toLowerCase() === cleanName.toLowerCase()
      )
    )
      next.name = "Another store already uses this name.";
    if (cleanLocation.length < 2) next.location = "Where does this store trade from?";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onSaved({
      name: cleanName,
      location: cleanLocation,
      address: address.trim(),
      phone: phone.trim(),
    });
    onOpenChange(false);
  };

  const fieldCls =
    "h-11 w-full rounded-md border bg-white px-3.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 dark:bg-white/5 dark:text-white";
  const fieldState = (hasError?: string) =>
    hasError
      ? "border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-500/10"
      : "border-slate-200 hover:border-slate-300 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl p-6 sm:max-w-[460px]">
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            {editing ? "Edit store" : "Add a store"}
          </DialogTitle>
          <DialogDescription className="text-[13.5px] text-slate-500 dark:text-slate-400">
            {editing
              ? "Update this storefront's details."
              : "New stores start empty — stock, requests and deliveries are recorded per store."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label htmlFor="store-name" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Store name
            </label>
            <input
              id="store-name"
              type="text"
              placeholder="e.g. Kabwata Branch"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
              }}
              aria-invalid={!!errors.name}
              className={cn(fieldCls, fieldState(errors.name))}
            />
            {errors.name && (
              <p role="alert" className="mt-1.5 text-xs text-rose-600">
                {errors.name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="store-location" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Location
            </label>
            <input
              id="store-location"
              type="text"
              placeholder="e.g. Kabwata, Lusaka"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                if (errors.location) setErrors((p) => ({ ...p, location: undefined }));
              }}
              aria-invalid={!!errors.location}
              className={cn(fieldCls, fieldState(errors.location))}
            />
            {errors.location && (
              <p role="alert" className="mt-1.5 text-xs text-rose-600">
                {errors.location}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="store-address" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Address <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="store-address"
              type="text"
              placeholder="e.g. Shop 4, Kabwata Market Arcade"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={cn(fieldCls, fieldState())}
            />
          </div>

          <div>
            <label htmlFor="store-phone" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Phone <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="store-phone"
              type="tel"
              placeholder="e.g. +260 96 411 0820"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={cn(fieldCls, fieldState())}
            />
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2">
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
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          >
            <Store className="h-4 w-4" aria-hidden="true" />
            {editing ? "Save changes" : "Create store"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PharmacyStores({
  stores,
  onStoresChange,
}: {
  stores: PharmacyStore[];
  onStoresChange: (stores: PharmacyStore[]) => void;
}) {
  const { toast } = useToast();

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PharmacyStore | null>(null);
  const [actor, setActor] = useState({ name: "", email: "" });

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
      setInventory(loadInventory());
      setHydrated(true);
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  /** Stock sitting in a given store. */
  const statsFor = (storeId: string) => {
    const scoped = inventory.filter((entry) => resolveStoreId(entry) === storeId);
    const units = scoped.reduce((acc, entry) => acc + entry.qty, 0);
    const value = scoped.reduce((acc, entry) => acc + entry.qty * entry.unitPrice, 0);
    return { skus: scoped.length, units, value };
  };

  const totals = useMemo(() => {
    const units = inventory.reduce((acc, entry) => acc + entry.qty, 0);
    const value = inventory.reduce((acc, entry) => acc + entry.qty * entry.unitPrice, 0);
    return { skus: inventory.length, units, value };
  }, [inventory]);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
    void trackEvent("pharmacy_store_add_opened");
  };

  const openEdit = (store: PharmacyStore) => {
    setEditing(store);
    setDialogOpen(true);
  };

  const audit = (title: string, detail: string) => {
    if (!actor.email) return;
    recordAudit({ title, action: "Update", detail, actor: actor.name, email: actor.email });
  };

  const handleSaved = (draft: StoreDraft) => {
    if (editing) {
      onStoresChange(
        stores.map((store) => (store.id === editing.id ? { ...store, ...draft } : store))
      );
      toast({
        title: "Store updated",
        description: `${draft.name}'s details were saved.`,
      });
      audit("Store Updated", `${draft.name} · ${draft.location}`);
      void trackEvent("pharmacy_store_updated", { store: editing.id });
    } else {
      const store: PharmacyStore = {
        id: nextStoreId(stores),
        ...draft,
        // The account's first storefront becomes its main store immediately.
        isMain: stores.length === 0,
        createdAt: Date.now(),
      };
      onStoresChange([...stores, store]);
      toast({
        title: "Store created",
        description: `${store.name} is ready — stock is recorded per store.`,
      });
      audit("Store Created", `${store.name} · ${store.location}`);
      void trackEvent("pharmacy_store_added", { store: store.id });
    }
  };

  const setMain = (store: PharmacyStore) => {
    if (store.isMain) return;
    onStoresChange(stores.map((entry) => ({ ...entry, isMain: entry.id === store.id })));
    toast({
      title: "Main store declared",
      description: `${store.name} is now the main store for this account.`,
    });
    audit("Main Store Declared", `${store.name} · ${store.location}`);
    void trackEvent("pharmacy_store_main_set", { store: store.id });
  };

  const removeStore = (store: PharmacyStore) => {
    if (store.isMain) {
      toast({
        title: "The main store can't be removed",
        description: "Declare another store as the main first.",
      });
      return;
    }
    const hasRecords =
      loadInventory().some((entry) => resolveStoreId(entry) === store.id) ||
      loadStockRequests().some((entry) => resolveStoreId(entry) === store.id) ||
      loadDeliveries().some((entry) => resolveStoreId(entry) === store.id);
    if (hasRecords) {
      toast({
        title: "Store still has records",
        description: `${store.name} holds stock, requests or deliveries — clear them first.`,
      });
      return;
    }
    onStoresChange(stores.filter((entry) => entry.id !== store.id));
    toast({
      title: "Store removed",
      description: `${store.name} is no longer part of this account.`,
    });
    audit("Store Removed", `${store.name} · ${store.location}`);
    void trackEvent("pharmacy_store_removed", { store: store.id });
  };

  const storeMenu = (store: PharmacyStore) => (
    <DropdownMenuContent align="end" className="w-52">
      <DropdownMenuLabel>
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{store.name}</p>
        <p className="truncate text-xs font-normal text-slate-500 dark:text-slate-400">
          {store.location}
        </p>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={store.isMain} onClick={() => setMain(store)}>
        <Star className="mr-2 h-4 w-4 text-purple-500" aria-hidden="true" />
        {store.isMain ? "Main store" : "Declare as main store"}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openEdit(store)}>
        <Pencil className="mr-2 h-4 w-4 text-slate-400" aria-hidden="true" />
        Edit details
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={store.isMain}
        onClick={() => removeStore(store)}
        className="text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-300"
      >
        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
        Remove store
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <div aria-labelledby="pharmacy-stores-title">
      <PageHeader
        icon={Warehouse}
        title="Stores"
        subtitle="Every storefront on this account — the main store is the application's home"
        tourId="ph-stores"
        actions={
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-shadow hover:shadow-[0_12px_26px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add store
          </button>
        }
      />
      <h2 id="pharmacy-stores-title" className="sr-only">
        Stores
      </h2>

      {/* Account-wide stats */}
      <div className={cn(pharmacyCardCls, "mt-5 flex flex-wrap gap-3 p-4")}>
        <div className="flex min-w-[120px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <p className="text-[18px] font-bold leading-none tracking-tight">
            {hydrated ? stores.length : "—"}
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
            Stores on this account
          </p>
        </div>
        <div className="flex min-w-[160px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <p className="truncate text-[18px] font-bold leading-none tracking-tight">
            {hydrated ? (stores.find((store) => store.isMain)?.name ?? "—") : "—"}
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
            Main store
          </p>
        </div>
        <div className="flex min-w-[120px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <p className="text-[18px] font-bold leading-none tracking-tight">
            {hydrated ? totals.units : "—"}
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
            Units across stores
          </p>
        </div>
        <div className="flex min-w-[120px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <p className="text-[18px] font-bold leading-none tracking-tight">
            {hydrated ? formatZMW(totals.value) : "—"}
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
            Total stock value
          </p>
        </div>
      </div>

      {/* Store cards */}
      <motion.div
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
        initial="hidden"
        animate="show"
        className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3"
      >
        {stores.length === 0 ? (
          <div
            className={cn(
              pharmacyCardCls,
              "col-span-full flex min-h-[190px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center"
            )}
          >
            <Warehouse className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
              No stores on this account yet.
            </p>
            <p className="text-[12.5px] text-slate-400 dark:text-slate-500">
              Add your first storefront to record stock, sales and requests against it.
            </p>
            <button
              type="button"
              onClick={openAdd}
              className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-3.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-shadow hover:shadow-[0_12px_26px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add your first store
            </button>
          </div>
        ) : (
          stores.map((store) => {
            const stats = statsFor(store.id);
          return (
            <motion.article
              key={store.id}
              variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
              className={cn(
                pharmacyCardCls,
                "flex flex-col p-5",
                store.isMain && "ring-1 ring-purple-200 dark:ring-purple-500/30"
              )}
            >
              <div className="flex items-start gap-3.5">
                <span
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white",
                    store.isMain
                      ? "bg-gradient-to-br from-purple-600 to-fuchsia-600 shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                      : "bg-gradient-to-br from-slate-400 to-slate-500 dark:from-slate-600 dark:to-slate-700"
                  )}
                  aria-hidden="true"
                >
                  {(store.name[0] ?? "S").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
                      {store.name}
                    </h3>
                    {store.isMain && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                        <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                        Main
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-slate-500 dark:text-slate-400">
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {store.location}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Actions for ${store.name}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-purple-100 bg-white text-slate-400 transition-colors hover:bg-purple-50 hover:text-purple-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-purple-300"
                    >
                      <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  {storeMenu(store)}
                </DropdownMenu>
              </div>

              {store.address && (
                <p className="mt-3.5 truncate text-[12.5px] text-slate-500 dark:text-slate-400">
                  {store.address}
                </p>
              )}
              {store.phone && (
                <p className="mt-1 flex items-center gap-1.5 truncate text-[12.5px] text-slate-500 dark:text-slate-400">
                  <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {store.phone}
                </p>
              )}

              <dl className="mt-4 grid grid-cols-3 gap-2.5 text-[12px]">
                <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5">
                  <dt className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                    <Package className="h-3 w-3" aria-hidden="true" />
                    SKUs
                  </dt>
                  <dd className="mt-1 font-bold tabular-nums text-slate-900 dark:text-white">
                    {hydrated ? stats.skus : "—"}
                  </dd>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5">
                  <dt className="text-slate-500 dark:text-slate-400">Units</dt>
                  <dd className="mt-1 font-bold tabular-nums text-slate-900 dark:text-white">
                    {hydrated ? stats.units : "—"}
                  </dd>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5">
                  <dt className="text-slate-500 dark:text-slate-400">Value</dt>
                  <dd className="mt-1 truncate font-bold tabular-nums text-slate-900 dark:text-white">
                    {hydrated ? formatZMW(stats.value) : "—"}
                  </dd>
                </div>
              </dl>

              <p className="mt-3.5 flex items-center gap-1.5 text-[12px] text-slate-400 dark:text-slate-500">
                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {store.isMain
                  ? "Home of the application — requests default here"
                  : `Added ${new Date(store.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}`}
              </p>
            </motion.article>
          );
          })
        )}
      </motion.div>

      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-slate-400 dark:text-slate-500">
        <Store className="h-3.5 w-3.5" aria-hidden="true" />
        Use the store view in the sidebar to focus the console on one storefront · exactly one store
        is always the main store
      </p>

      <StoreDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        stores={stores}
        editing={editing}
        onSaved={handleSaved}
      />
    </div>
  );
}
