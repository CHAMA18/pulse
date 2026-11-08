"use client";

import { motion } from "framer-motion";
import {
  ClipboardCheck,
  Eye,
  PackageCheck,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatDay,
  formatZMW,
  loadCatalogue,
  loadDeliveries,
  loadPurchaseOrders,
  loadSuppliers,
  nextId,
  resolveStoreId,
  saveDeliveries,
  savePurchaseOrders,
  type CatalogueProduct,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type Supplier,
} from "@/components/pharmacy/pharmacy-data";
import {
  PageHeader,
  pharmacyCardCls,
  brandBtnCls,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/* ------------------------------------------------------------------ */
/* Purchase Orders                                                     */
/* ------------------------------------------------------------------ */
/* Raise orders to network suppliers, send them, and mark them         */
/* received — receiving files a delivery record automatically so the   */
/* Deliveries page and audit trail stay honest.                        */

type StatusFilter = "all" | PurchaseOrderStatus;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "sent", label: "Sent" },
  { id: "received", label: "Received" },
  { id: "cancelled", label: "Cancelled" },
];

type DraftLine = { key: number; productId: string; qty: string; unitCost: string };

function KpiChip({ value, label, tone = "slate" }: { value: string; label: string; tone?: "slate" | "purple" | "amber" | "emerald" }) {
  return (
    <div className="flex min-w-[132px] flex-1 flex-col rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
      <p
        className={cn(
          "text-[18px] font-bold leading-none tracking-tight tabular-nums",
          tone === "purple" && "text-purple-700 dark:text-purple-300",
          tone === "amber" && "text-amber-600 dark:text-amber-400",
          tone === "emerald" && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

export function PharmacyPurchaseOrders({ storeId = "all" }: { storeId?: string }) {
  const { toast } = useToast();

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueProduct[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [viewOrder, setViewOrder] = useState<PurchaseOrder | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [actor, setActor] = useState({ name: "", email: "" });

  // Create form
  const [supplier, setSupplier] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, productId: "", qty: "", unitCost: "" }]);

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
      setOrders(loadPurchaseOrders());
      setSuppliers(loadSuppliers());
      setCatalogue(loadCatalogue());
      setHydrated(true);
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  /** Orders follow the sidebar's store view; legacy orders sit in the main store. */
  const visibleScope = useMemo(
    () => (storeId === "all" ? orders : orders.filter((order) => resolveStoreId(order) === storeId)),
    [orders, storeId]
  );

  const filtered = useMemo(
    () =>
      [...visibleScope]
        .filter((order) => filter === "all" || order.status === filter)
        .sort((a, b) => b.createdAt - a.createdAt),
    [visibleScope, filter]
  );

  const openOrders = visibleScope.filter((order) => order.status === "draft" || order.status === "sent");
  const sentOrders = visibleScope.filter((order) => order.status === "sent");
  const receivedOrders = visibleScope.filter((order) => order.status === "received");
  const orderValue = (order: PurchaseOrder) =>
    order.lines.reduce((acc, line) => acc + line.qty * line.unitCost, 0);
  const openValue = openOrders.reduce((acc, order) => acc + orderValue(order), 0);

  const resetForm = () => {
    setSupplier("");
    setExpectedAt("");
    setNotes("");
    setLines([{ key: 1, productId: "", qty: "", unitCost: "" }]);
  };

  const draftLines = lines
    .map((line) => {
      const product = catalogue.find((entry) => entry.id === line.productId);
      return product
        ? { product, qty: Math.max(0, Math.round(Number(line.qty) || 0)), unitCost: Math.max(0, Number(line.unitCost) || 0) }
        : null;
    })
    .filter((line): line is { product: CatalogueProduct; qty: number; unitCost: number } => line !== null && line.qty > 0);
  const draftTotal = draftLines.reduce((acc, line) => acc + line.qty * line.unitCost, 0);
  const canCreate = supplier.length > 0 && draftLines.length > 0;

  const pickProduct = (key: number, productId: string) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const product = catalogue.find((entry) => entry.id === productId);
        return {
          ...line,
          productId,
          // Suggest a wholesale cost slightly under the shelf price — editable.
          unitCost: product ? String(Math.round(product.price * 0.8)) : line.unitCost,
        };
      })
    );
  };

  const buildOrder = (status: PurchaseOrderStatus): PurchaseOrder => {
    const now = Date.now();
    return {
      id: nextId(orders, "PO"),
      supplier,
      status,
      createdAt: now,
      expectedAt: expectedAt || undefined,
      lines: draftLines.map((line, index) => ({
        id: `pol-${index + 1}`,
        name: line.product.name,
        qty: line.qty,
        unitCost: line.unitCost,
      })),
      notes: notes.trim() || undefined,
      storeId: storeId === "all" ? undefined : storeId,
      ...(status === "sent" ? { sentAt: now } : {}),
    };
  };

  const createOrder = (status: PurchaseOrderStatus) => {
    if (!canCreate) return;
    const order = buildOrder(status);
    const next = [order, ...orders];
    setOrders(next);
    savePurchaseOrders(next);
    if (actor.email) {
      recordAudit({
        title: status === "sent" ? "Purchase Order Sent" : "Purchase Order Created",
        action: "Update",
        detail: `${order.id} · ${order.supplier} · ${order.lines.length} line${order.lines.length === 1 ? "" : "s"} · ${formatZMW(orderValue(order))}`,
        actor: actor.name,
        email: actor.email,
      });
    }
    void trackEvent("pharmacy_po_created", { order: order.id, status });
    toast({
      title: status === "sent" ? `${order.id} sent to ${order.supplier}` : `${order.id} saved as draft`,
      description:
        status === "sent"
          ? "Mark it received when the goods land."
          : "Send it whenever you're ready — it stays editable in spirit.",
    });
    setCreateOpen(false);
    resetForm();
  };

  const updateOrder = (id: string, patch: Partial<PurchaseOrder>, auditTitle: string) => {
    const next = orders.map((order) => (order.id === id ? { ...order, ...patch } : order));
    setOrders(next);
    savePurchaseOrders(next);
    const order = next.find((entry) => entry.id === id);
    if (order && actor.email) {
      recordAudit({
        title: auditTitle,
        action: "Update",
        detail: `${order.id} · ${order.supplier}`,
        actor: actor.name,
        email: actor.email,
      });
    }
    setViewOrder((current) => (current && current.id === id ? { ...current, ...patch } : current));
  };

  /** Sending: draft → sent. */
  const sendOrder = (order: PurchaseOrder) => {
    updateOrder(order.id, { status: "sent", sentAt: Date.now() }, "Purchase Order Sent");
    void trackEvent("pharmacy_po_sent", { order: order.id });
    toast({ title: `${order.id} sent`, description: `${order.supplier} will confirm the delivery window.` });
  };

  /** Receiving: sent → received, and a delivery record is filed automatically. */
  const receiveOrder = (order: PurchaseOrder) => {
    updateOrder(order.id, { status: "received", receivedAt: Date.now() }, "Purchase Order Received");
    const deliveries = loadDeliveries();
    const delivery = {
      id: nextId(deliveries, "DLV"),
      supplier: order.supplier,
      items: order.lines.map((line) => `${line.name} × ${line.qty}`).join(" · "),
      units: order.lines.reduce((acc, line) => acc + line.qty, 0),
      receivedAt: Date.now(),
      condition: "verified" as const,
      storeId: storeId === "all" ? undefined : storeId,
    };
    saveDeliveries([delivery, ...deliveries]);
    void trackEvent("pharmacy_po_received", { order: order.id, units: delivery.units });
    toast({
      title: `${order.id} received`,
      description: `${delivery.units} units filed as delivery ${delivery.id}.`,
    });
  };

  /** Cancelling: draft/sent → cancelled. */
  const cancelOrder = (order: PurchaseOrder) => {
    updateOrder(order.id, { status: "cancelled" }, "Purchase Order Cancelled");
    void trackEvent("pharmacy_po_cancelled", { order: order.id });
    toast({ title: `${order.id} cancelled`, description: "The supplier order was withdrawn." });
  };

  const StatusIcon: LucideIcon = filtered.length === 0 ? PackageCheck : ClipboardCheck;

  return (
    <div aria-labelledby="pharmacy-po-title">
      <PageHeader
        icon={ClipboardCheck}
        title="Purchase Orders"
        subtitle="Order from network suppliers — send, track and receive in one place"
        actions={
          <button
            type="button"
            onClick={() => {
              setCreateOpen(true);
              setSupplier(suppliers[0]?.name ?? "");
              setExpectedAt(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
            }}
            className={cn(brandBtnCls, "h-10 px-4 text-[13.5px] font-semibold")}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New purchase order
          </button>
        }
      />
      <h2 id="pharmacy-po-title" className="sr-only">
        Purchase Orders
      </h2>

      {/* KPIs */}
      <div className={cn(pharmacyCardCls, "mt-5 flex flex-wrap gap-3 p-4")}>
        <KpiChip value={String(hydrated ? openOrders.length : "—")} label="Open orders" tone="purple" />
        <KpiChip value={String(hydrated ? sentOrders.length : "—")} label="Awaiting delivery" tone="amber" />
        <KpiChip value={String(hydrated ? receivedOrders.length : "—")} label="Received" tone="emerald" />
        <KpiChip value={hydrated ? formatZMW(openValue) : "—"} label="Open order value" />
      </div>

      {/* Status filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Filter by order status">
        {STATUS_FILTERS.map(({ id, label }) => {
          const active = filter === id;
          const count =
            id === "all" ? visibleScope.length : visibleScope.filter((order) => order.status === id).length;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setFilter(id)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                active
                  ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
              )}
            >
              {label}
              <span className={cn("text-[11px] font-bold", active ? "text-white/70" : "text-slate-400")}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Orders table */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
        className={cn(pharmacyCardCls, "mt-5 overflow-hidden")}
      >
        {filtered.length === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
            <StatusIcon className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="text-[13.5px] font-medium text-slate-500 dark:text-slate-400">
              {filter === "all" ? "No purchase orders yet." : `No ${filter} orders right now.`}
            </p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="text-[13px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
            >
              Raise the first order
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11.5px] uppercase tracking-[0.12em] text-slate-400 dark:border-white/5">
                  <th scope="col" className="px-5 py-3 font-semibold">Order</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Supplier</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Lines</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Units</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Value</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Expected</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-white/5">
                    <td className="px-5 py-3.5">
                      <p className="font-bold text-slate-900 dark:text-white">{order.id}</p>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">raised {formatDay(order.createdAt)}</p>
                    </td>
                    <td className="max-w-[200px] px-3 py-3.5">
                      <p className="truncate font-semibold text-slate-700 dark:text-slate-200">{order.supplier}</p>
                      {order.notes && (
                        <p className="truncate text-[12px] text-slate-400 dark:text-slate-500">{order.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-right tabular-nums">{order.lines.length}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums">
                      {order.lines.reduce((acc, line) => acc + line.qty, 0)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatZMW(orderValue(order))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-slate-600 dark:text-slate-300">
                      {order.expectedAt
                        ? new Date(order.expectedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })
                        : "—"}
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusPill status={order.status} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          aria-label={`View ${order.id}`}
                          title="View order"
                          onClick={() => setViewOrder(order)}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {order.status === "draft" && (
                          <button
                            type="button"
                            aria-label={`Send ${order.id}`}
                            title="Send to supplier"
                            onClick={() => sendOrder(order)}
                            className="flex h-8 items-center gap-1.5 rounded-md bg-purple-600 px-2.5 text-[12px] font-bold text-white transition-colors hover:bg-purple-700"
                          >
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                            Send
                          </button>
                        )}
                        {order.status === "sent" && (
                          <button
                            type="button"
                            aria-label={`Mark ${order.id} received`}
                            title="Mark received — files a delivery"
                            onClick={() => receiveOrder(order)}
                            className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-[12px] font-bold text-white transition-colors hover:bg-emerald-700"
                          >
                            <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            Receive
                          </button>
                        )}
                        {(order.status === "draft" || order.status === "sent") && (
                          <button
                            type="button"
                            aria-label={`Cancel ${order.id}`}
                            title="Cancel order"
                            onClick={() => cancelOrder(order)}
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-white/10 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      <p className="mt-3 text-[12px] text-slate-400 dark:text-slate-500">
        Showing {filtered.length} of {visibleScope.length} orders in this store view · receiving an order files a
        verified delivery automatically
      </p>

      {/* View order */}
      <Dialog open={viewOrder !== null} onOpenChange={(open) => !open && setViewOrder(null)}>
        <DialogContent className="max-w-lg">
          {viewOrder && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5">
                  {viewOrder.id}
                  <StatusPill status={viewOrder.status} />
                </DialogTitle>
                <DialogDescription>
                  {viewOrder.supplier} · raised {formatDay(viewOrder.createdAt)}
                  {viewOrder.expectedAt
                    ? ` · expected ${new Date(viewOrder.expectedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`
                    : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="overflow-hidden rounded-lg border border-slate-100 dark:border-white/10">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-[0.1em] text-slate-400 dark:border-white/5 dark:bg-white/5">
                      <th scope="col" className="px-3.5 py-2.5 font-semibold">Item</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">Qty</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">Unit cost</th>
                      <th scope="col" className="px-3.5 py-2.5 text-right font-semibold">Line</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {viewOrder.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3.5 py-2.5 font-medium text-slate-800 dark:text-slate-100">{line.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{line.qty}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">
                          {formatZMW(line.unitCost)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold tabular-nums">
                          {formatZMW(line.qty * line.unitCost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-100 dark:border-white/10">
                      <td colSpan={3} className="px-3.5 py-2.5 text-right text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                        Order total
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-[14px] font-bold tabular-nums text-purple-700 dark:text-purple-300">
                        {formatZMW(orderValue(viewOrder))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {viewOrder.notes && (
                <p className="rounded-lg bg-slate-50 px-3.5 py-2.5 text-[12.5px] leading-snug text-slate-600 dark:bg-white/5 dark:text-slate-300">
                  {viewOrder.notes}
                </p>
              )}

              <p className="text-[12px] text-slate-400 dark:text-slate-500">
                {viewOrder.sentAt ? `Sent ${formatDay(viewOrder.sentAt)} · ` : ""}
                {viewOrder.receivedAt ? `Received ${formatDay(viewOrder.receivedAt)}` : ""}
                {!viewOrder.sentAt && !viewOrder.receivedAt && "Not sent yet."}
              </p>

              {(viewOrder.status === "draft" || viewOrder.status === "sent") && (
                <DialogFooter>
                  <button
                    type="button"
                    onClick={() => cancelOrder(viewOrder)}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 px-4 text-[13.5px] font-semibold text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-white/10 dark:text-slate-300 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                  >
                    Cancel order
                  </button>
                  {viewOrder.status === "draft" ? (
                    <button
                      type="button"
                      onClick={() => sendOrder(viewOrder)}
                      className={cn(brandBtnCls, "h-10 px-4 text-[13.5px] font-semibold")}
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                      Send to supplier
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => receiveOrder(viewOrder)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-emerald-700"
                    >
                      <PackageCheck className="h-4 w-4" aria-hidden="true" />
                      Mark received
                    </button>
                  )}
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create order */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New purchase order</DialogTitle>
            <DialogDescription>
              Pick the supplier, add the lines you need, then save as a draft or send it straight away.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="po-supplier">Supplier</Label>
                <Select value={supplier} onValueChange={setSupplier}>
                  <SelectTrigger id="po-supplier" className="w-full">
                    <SelectValue placeholder="Choose a supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((entry) => (
                      <SelectItem key={entry.id} value={entry.name}>
                        {entry.name}
                        {entry.verified ? " ✓" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="po-expected">Expected delivery</Label>
                <Input
                  id="po-expected"
                  type="date"
                  value={expectedAt}
                  onChange={(e) => setExpectedAt(e.target.value)}
                />
              </div>
            </div>

            {/* Lines */}
            <div className="grid gap-2">
              <Label>Order lines</Label>
              {lines.map((line, index) => {
                const product = catalogue.find((entry) => entry.id === line.productId);
                return (
                  <div key={line.key} className="flex items-center gap-2">
                    <div className="min-w-0 flex-[2]">
                      <Select value={line.productId} onValueChange={(v) => pickProduct(line.key, v)}>
                        <SelectTrigger className="w-full" aria-label={`Line ${index + 1} product`}>
                          <SelectValue placeholder="Product" />
                        </SelectTrigger>
                        <SelectContent>
                          {catalogue.map((entry) => (
                            <SelectItem key={entry.id} value={entry.id}>
                              {entry.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={line.qty}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) => (l.key === line.key ? { ...l, qty: e.target.value } : l))
                        )
                      }
                      placeholder="Qty"
                      aria-label={`Line ${index + 1} quantity`}
                      className="w-20 shrink-0"
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={line.unitCost}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) => (l.key === line.key ? { ...l, unitCost: e.target.value } : l))
                        )
                      }
                      placeholder="Cost"
                      aria-label={`Line ${index + 1} unit cost in Kwacha`}
                      className="w-24 shrink-0"
                    />
                    <button
                      type="button"
                      aria-label={`Remove line ${index + 1}`}
                      disabled={lines.length === 1}
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      className="flex h-10 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() =>
                    setLines((prev) => [...prev, { key: Date.now(), productId: "", qty: "", unitCost: "" }])
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-purple-200 bg-white px-3 text-[12.5px] font-semibold text-purple-700 transition-colors hover:bg-purple-50 dark:border-purple-500/25 dark:bg-transparent dark:text-purple-300 dark:hover:bg-purple-500/10"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add line
                </button>
                <p className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">
                  {draftLines.length > 0 ? formatZMW(draftTotal) : formatZMW(0)}
                </p>
              </div>
              {draftLines.length === 0 && (
                <p className="flex items-center gap-1.5 text-[12px] text-slate-400 dark:text-slate-500">
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  Pick at least one product with a quantity to raise the order.
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="po-notes">Notes (optional)</Label>
              <Textarea
                id="po-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the supplier should know"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="mt-1">
            <button
              type="button"
              disabled={!canCreate}
              onClick={() => createOrder("draft")}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/5"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              Save draft
            </button>
            <button
              type="button"
              disabled={!canCreate}
              onClick={() => createOrder("sent")}
              className={cn(brandBtnCls, "h-10 px-4 text-[13.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none")}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Create & send
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
