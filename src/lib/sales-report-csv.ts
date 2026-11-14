import type { NetworkPharmacySale } from "@/lib/cloud/pharmacy-sales";

const HEADERS = [
  "Sale ID",
  "Sold at",
  "Pharmacy",
  "Store",
  "Cashier",
  "Payment method",
  "Product",
  "Quantity",
  "Unit price (ZMW)",
  "Line total (ZMW)",
  "Sale subtotal (ZMW)",
  "Discount (ZMW)",
  "Sale total (ZMW)",
  "Status",
  "Reversal reason",
  "Reversed at",
];

function csvCell(value: string | number | null | undefined): string {
  if (typeof value === "number") return String(value);
  let text = value ?? "";
  // Keep spreadsheet apps from treating free-text fields as formulas.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function storeName(sale: NetworkPharmacySale): string {
  return sale.storeName || sale.storeId || "Main store";
}

function isoDate(value: number | undefined): string {
  return value ? new Date(value).toISOString() : "";
}

/** One row per sale line so the CSV keeps the report's product-level detail. */
export function buildSalesReportCsv(sales: NetworkPharmacySale[]): string {
  const rows: string[] = [HEADERS.map(csvCell).join(",")];

  for (const sale of [...sales].sort((a, b) => b.soldAt - a.soldAt)) {
    for (const line of sale.lines) {
      rows.push(
        [
          sale.id,
          isoDate(sale.soldAt),
          sale.pharmacyName,
          storeName(sale),
          sale.servedBy,
          sale.method,
          line.name,
          line.qty,
          line.unitPrice,
          line.qty * line.unitPrice,
          sale.subtotal,
          sale.discount,
          sale.total,
          sale.reversedAt ? "Reversed" : "Completed",
          sale.reversalReason ?? "",
          isoDate(sale.reversedAt),
        ]
          .map(csvCell)
          .join(",")
      );
    }
  }

  return rows.join("\r\n");
}
