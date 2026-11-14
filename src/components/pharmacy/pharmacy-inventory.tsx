"use client";

import { Package } from "lucide-react";
import { PharmacyCatalogue } from "@/components/pharmacy/pharmacy-catalogue";
import { PageHeader } from "@/components/pharmacy/pharmacy-shared";
import type { PharmacyStore } from "@/components/pharmacy/pharmacy-data";

/* ------------------------------------------------------------------ */
/* Inventory — the product catalogue                                   */
/* ------------------------------------------------------------------ */

export function PharmacyInventory({
  stores = [],
  onSell,
  canManageProducts = true,
}: {
  /** Every storefront — the catalogue books opening stock onto them. */
  stores?: PharmacyStore[];
  /** Jump to the counter with the catalogue ready to sell. */
  onSell?: () => void;
  /** Owners, managers and pharmacists may add or import products. */
  canManageProducts?: boolean;
}) {
  return (
    <div aria-labelledby="pharmacy-inventory-title">
      <PageHeader
        icon={Package}
        title="Inventory"
        subtitle="Your product catalogue — prices, packs and live stock across your shelves"
        tourId="ph-inventory"
      />
      <h2 id="pharmacy-inventory-title" className="sr-only">
        Inventory
      </h2>

      <PharmacyCatalogue
        stores={stores}
        onSell={onSell}
        canManage={canManageProducts}
      />
    </div>
  );
}
