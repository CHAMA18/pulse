"use client";

import { motion } from "framer-motion";
import {
  AlertCircle,
  BadgeCheck,
  PackageCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatDay,
  loadDeliveries,
  nextId,
  resolveStoreId,
  saveDeliveries,
  type Delivery,
} from "@/components/pharmacy/pharmacy-data";
import {
  PageHeader,
  pharmacyCardCls,
  StatusPill,
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

/* ------------------------------------------------------------------ */
/* Record delivery dialog                                              */
/* ------------------------------------------------------------------ */

function RecordDeliveryDialog({
  open,
  onOpenChange,
  deliveries,
  onRecorded,
  actor,
  storeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deliveries: Delivery[];
  onRecorded: (delivery: Delivery) => void;
  actor: { name: string; email: string };
  /** Receiving store for the goods ("all" records into the main store). */
  storeId: string;
}) {
  const { toast } = useToast();

  const [supplier, setSupplier] = useState("");
  const [items, setItems] = useState("");
  const [units, setUnits] = useState("");
  const [errors, setErrors] = useState<{ supplier?: string; items?: string; units?: string }>({});

  const supplierRef = useRef<HTMLInputElement>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSupplier("");
      setItems("");
      setUnits("");
      setErrors({});
    }
  }

  const validate = () => {
    const next: typeof errors = {};
    if (supplier.trim().length < 2) next.supplier = "Name the delivering supplier.";
    if (items.trim().length < 2) next.items = "List what arrived.";
    const parsed = Number.parseInt(units, 10);
    if (!units.trim() || !Number.isFinite(parsed) || parsed < 1)
      next.units = "Record at least one unit.";
    return next;
  };

  const submit = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.supplier) supplierRef.current?.focus();
      return;
    }

    const delivery: Delivery = {
      id: nextId(deliveries, "DLV"),
      supplier: supplier.trim(),
      items: items.trim(),
      units: Number.parseInt(units, 10),
      receivedAt: Date.now(),
      condition: "verified",
      ...(storeId !== "all" ? { storeId } : {}),
    };
    onRecorded(delivery);
    toast({
      title: "Goods received",
      description: `${delivery.id} · ${delivery.supplier} logged against your shelves.`,
    });
    if (actor.email) {
      recordAudit({
        title: "Goods Received",
        action: "Activity",
        detail: `${delivery.id} · ${delivery.supplier} · ${delivery.units} units`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_delivery_recorded", { units: delivery.units });
    onOpenChange(false);
  };

  const inputBase =
    "h-11 w-full rounded-md border bg-white px-3.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 dark:bg-white/5 dark:text-white";

  const inputState = (hasError?: string) =>
    hasError
      ? "border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-500/10"
      : "border-slate-200 hover:border-slate-300 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10";

  const fieldError = (message?: string) =>
    message && (
      <p role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
        <AlertCircle className="h-3.5 w-3.5" /> {message}
      </p>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="rounded-2xl p-6 sm:max-w-[460px]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          supplierRef.current?.focus();
        }}
      >
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            Record delivery
          </DialogTitle>
          <DialogDescription className="text-[13.5px] text-slate-500 dark:text-slate-400">
            Log goods received from the Pulse hub or a wholesaler.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label htmlFor="delivery-supplier" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Supplier
            </label>
            <input
              ref={supplierRef}
              id="delivery-supplier"
              type="text"
              placeholder="e.g. Pulse Central Hub"
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value);
                if (errors.supplier) setErrors((p) => ({ ...p, supplier: undefined }));
              }}
              aria-invalid={!!errors.supplier}
              className={cn(inputBase, inputState(errors.supplier))}
            />
            {fieldError(errors.supplier)}
          </div>

          <div>
            <label htmlFor="delivery-items" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Items received
            </label>
            <input
              id="delivery-items"
              type="text"
              placeholder="e.g. Amoxicillin 250mg × 60"
              value={items}
              onChange={(e) => {
                setItems(e.target.value);
                if (errors.items) setErrors((p) => ({ ...p, items: undefined }));
              }}
              aria-invalid={!!errors.items}
              className={cn(inputBase, inputState(errors.items))}
            />
            {fieldError(errors.items)}
          </div>

          <div>
            <label htmlFor="delivery-units" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Total units
            </label>
            <input
              id="delivery-units"
              type="number"
              min={1}
              placeholder="e.g. 60"
              value={units}
              onChange={(e) => {
                setUnits(e.target.value);
                if (errors.units) setErrors((p) => ({ ...p, units: undefined }));
              }}
              aria-invalid={!!errors.units}
              className={cn(inputBase, inputState(errors.units))}
            />
            {fieldError(errors.units)}
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
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            Record goods
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PharmacyDeliveries({ storeId = "all" }: { storeId?: string }) {
  const { toast } = useToast();

  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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
      setDeliveries(loadDeliveries());
      setHydrated(true);
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // The ledger follows the sidebar's store view; goods land in that store.
  const visible = useMemo(
    () =>
      storeId === "all"
        ? deliveries
        : deliveries.filter((entry) => resolveStoreId(entry) === storeId),
    [deliveries, storeId]
  );

  const sorted = useMemo(
    () => [...visible].sort((a, b) => b.receivedAt - a.receivedAt),
    [visible]
  );

  const unitsTotal = visible.reduce((acc, d) => acc + d.units, 0);
  const lastDelivery = sorted[0];

  const onRecorded = (delivery: Delivery) => {
    setDeliveries((prev) => {
      const next = [delivery, ...prev];
      saveDeliveries(next);
      return next;
    });
  };

  const EmptyIcon: LucideIcon = Truck;

  return (
    <div aria-labelledby="pharmacy-deliveries-title">
      <PageHeader
        icon={Truck}
        title="Deliveries"
        subtitle="Goods received from the Pulse hub and wholesalers"
        tourId="ph-deliveries"
        actions={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-shadow hover:shadow-[0_12px_26px_-8px_rgba(147,51,234,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          >
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            Record delivery
          </button>
        }
      />
      <h2 id="pharmacy-deliveries-title" className="sr-only">
        Deliveries
      </h2>

      {/* Stats */}
      <div className={cn(pharmacyCardCls, "mt-5 flex flex-wrap gap-3 p-4")}>
        <div className="flex min-w-[128px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <p className="text-[18px] font-bold leading-none tracking-tight">
            {hydrated ? deliveries.length : "—"}
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
            Deliveries received
          </p>
        </div>
        <div className="flex min-w-[128px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <p className="text-[18px] font-bold leading-none tracking-tight">
            {hydrated ? unitsTotal : "—"}
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
            Units received
          </p>
        </div>
        <div className="flex min-w-[128px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <p className="text-[18px] font-bold leading-none tracking-tight">
            {hydrated && lastDelivery ? formatDay(lastDelivery.receivedAt) : "—"}
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
            Last delivery
          </p>
        </div>
      </div>

      {/* Timeline */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
        className={cn(pharmacyCardCls, "mt-5 overflow-hidden")}
      >
        {sorted.length === 0 ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
            <EmptyIcon className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
              No deliveries recorded yet.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-slate-100 dark:divide-white/5">
            {sorted.map((delivery) => (
              <li key={delivery.id} className="flex items-start gap-3.5 px-5 py-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
                  <Truck className="h-5 w-5" strokeWidth={2.1} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <p className="font-semibold text-slate-900 dark:text-white">{delivery.supplier}</p>
                    <span className="font-mono text-[12px] text-slate-400 dark:text-slate-500">
                      {delivery.id}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-slate-500 dark:text-slate-400">
                    {delivery.items}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="text-[13.5px] font-bold tabular-nums">
                    {delivery.units} {delivery.units === 1 ? "unit" : "units"}
                  </span>
                  <div className="flex items-center gap-2">
                    <StatusPill status={delivery.condition} label="Verified" />
                    <time className="whitespace-nowrap text-[12.5px] text-slate-500 dark:text-slate-400">
                      {formatDay(delivery.receivedAt)}
                    </time>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </motion.div>

      {hydrated && sorted.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-slate-400 dark:text-slate-500">
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
          Every delivery is condition-checked against its stock request before it hits your shelves.
          {lastDelivery ? ` Latest: ${lastDelivery.id} · ${lastDelivery.units} units.` : ""}
        </div>
      )}

      <RecordDeliveryDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        deliveries={visible}
        onRecorded={onRecorded}
        actor={actor}
        storeId={storeId}
      />
    </div>
  );
}
