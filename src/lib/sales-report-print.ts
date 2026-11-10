import type { NetworkPharmacy, NetworkPharmacySale } from "@/lib/cloud/pharmacy-sales";

type PharmacySalesSummary = {
  id: string;
  name: string;
  transactions: number;
  reversed: number;
  units: number;
  revenue: number;
  lastSaleAt?: number;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function money(value: number): string {
  return `K ${Math.round(value).toLocaleString("en-US")}`;
}

function dateTime(value: number): string {
  return new Intl.DateTimeFormat("en-ZM", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function paymentName(method: NetworkPharmacySale["method"]): string {
  return method === "mobile" ? "Mobile money" : method === "cash" ? "Cash" : "Card";
}

function summarizePharmacies(
  sales: NetworkPharmacySale[],
  pharmacies: NetworkPharmacy[]
): PharmacySalesSummary[] {
  const summaries = new Map<string, PharmacySalesSummary>();
  for (const pharmacy of pharmacies) {
    summaries.set(pharmacy.id, {
      id: pharmacy.id,
      name: pharmacy.name,
      transactions: 0,
      reversed: 0,
      units: 0,
      revenue: 0,
    });
  }

  for (const sale of sales) {
    const summary = summaries.get(sale.pharmacyId) ?? {
      id: sale.pharmacyId,
      name: sale.pharmacyName,
      transactions: 0,
      reversed: 0,
      units: 0,
      revenue: 0,
    };
    summary.transactions += 1;
    summary.lastSaleAt = Math.max(summary.lastSaleAt ?? sale.soldAt, sale.soldAt);
    if (sale.reversedAt) {
      summary.reversed += 1;
    } else {
      summary.units += sale.lines.reduce((total, line) => total + line.qty, 0);
      summary.revenue += sale.total;
    }
    summaries.set(sale.pharmacyId, summary);
  }

  return Array.from(summaries.values()).sort(
    (a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name)
  );
}

function pulseLogo(): string {
  return `<svg width="48" height="48" viewBox="0 0 64 64" role="img" aria-label="Pulse logo" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="pulse-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#d946ef"/><stop offset=".5" stop-color="#b026ff"/><stop offset="1" stop-color="#8b2fe8"/></linearGradient></defs>
    <g stroke="url(#pulse-g)" stroke-width="2" opacity=".5" fill="none"><line x1="32" y1="7" x2="50" y2="16"/><line x1="50" y1="16" x2="57" y2="32"/><line x1="57" y1="32" x2="50" y2="48"/><line x1="50" y1="48" x2="32" y2="57"/><line x1="32" y1="57" x2="14" y2="48"/><line x1="14" y1="48" x2="7" y2="32"/><line x1="7" y1="32" x2="14" y2="16"/><line x1="14" y1="16" x2="32" y2="7"/></g>
    <g fill="url(#pulse-g)"><circle cx="32" cy="7" r="4.4"/><circle cx="50" cy="16" r="4.4"/><circle cx="57" cy="32" r="4.4"/><circle cx="50" cy="48" r="4.4"/><circle cx="32" cy="57" r="4.4"/><circle cx="14" cy="48" r="4.4"/><circle cx="7" cy="32" r="4.4"/><circle cx="14" cy="16" r="4.4"/></g>
    <polyline points="6,32 22,32 27,23 32,41 36,16 41,34 44,32 58,32" fill="none" stroke="url(#pulse-g)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function buildSalesReportPrintHtml(input: {
  sales: NetworkPharmacySale[];
  pharmacies: NetworkPharmacy[];
  rangeLabel: string;
  pharmacyScope: string;
  generatedAt: number;
}): string {
  const { sales, pharmacies, rangeLabel, pharmacyScope, generatedAt } = input;
  const completed = sales.filter((sale) => !sale.reversedAt);
  const totalUnits = completed.reduce(
    (sum, sale) => sum + sale.lines.reduce((lineSum, line) => lineSum + line.qty, 0),
    0
  );
  const totalRevenue = completed.reduce((sum, sale) => sum + sale.total, 0);
  const reversalCount = sales.filter((sale) => Boolean(sale.reversedAt)).length;
  const summary = summarizePharmacies(sales, pharmacies);
  const sortedSales = [...sales].sort((a, b) => b.soldAt - a.soldAt);

  const summaryRows = summary.length
    ? summary.map((pharmacy) => `<tr>
        <td class="strong">${escapeHtml(pharmacy.name)}</td>
        <td class="number">${pharmacy.transactions}</td>
        <td class="number">${pharmacy.units}</td>
        <td class="number strong">${money(pharmacy.revenue)}</td>
        <td class="number">${pharmacy.reversed}</td>
        <td>${pharmacy.lastSaleAt ? dateTime(pharmacy.lastSaleAt) : "No sales"}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty">No pharmacies are available for this report.</td></tr>`;

  const transactionRows = sortedSales.length
    ? sortedSales.map((sale) => {
        const productLines = sale.lines.map((line) => `<li>
          <span>${escapeHtml(line.name)} <span class="muted">· ${line.qty} × ${money(line.unitPrice)}</span></span>
          <strong>${money(line.qty * line.unitPrice)}</strong>
        </li>`).join("");
        const reversalDetails = sale.reversedAt
          ? [
              dateTime(sale.reversedAt),
              sale.reversedBy ? `by ${escapeHtml(sale.reversedBy)}` : "",
              sale.reversalReason ? `Reason: ${escapeHtml(sale.reversalReason)}` : "",
              sale.refundHandled === undefined
                ? ""
                : `Refund handled: ${sale.refundHandled ? "Yes" : "No"}`,
            ].filter(Boolean).join(" · ")
          : "";
        const status = sale.reversedAt
          ? `<span class="status reversed">Reversed</span><div class="muted status-note">${reversalDetails}</div>`
          : `<span class="status complete">Completed</span>`;
        const cashDetails = sale.tendered !== undefined
          ? `<div class="muted">Tendered ${money(sale.tendered)}${sale.change !== undefined ? ` · Change ${money(sale.change)}` : ""}</div>`
          : "";
        return `<tr>
          <td><div class="strong">${dateTime(sale.soldAt)}</div><div class="muted">${escapeHtml(sale.id)}</div></td>
          <td><div class="strong">${escapeHtml(sale.pharmacyName)}</div><div class="muted">${escapeHtml(sale.storeName || sale.storeId || "Main store")}</div></td>
          <td><ul class="products">${productLines}</ul><div class="muted totals-note">Subtotal ${money(sale.subtotal)} · Discount ${money(sale.discount)}</div></td>
          <td>${paymentName(sale.method)}</td>
          <td>${escapeHtml(sale.servedBy)}</td>
          <td class="number"><div class="strong">${money(sale.total)}</div>${cashDetails}</td>
          <td>${status}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="7" class="empty">No POS transactions were recorded for this period.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pulse Sales Report</title>
  <style>
    @page { size: A4 landscape; margin: 13mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #182033; background: #fff; font: 10px/1.45 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .document { width: 100%; }
    .brand { display: flex; align-items: center; gap: 10px; padding-bottom: 13px; border-bottom: 2px solid #a414ec; }
    .logo { display: grid; width: 50px; height: 50px; place-items: center; border-radius: 13px; background: #f7eaff; }
    .brand-name { color: #a414ec; font-size: 24px; font-weight: 700; letter-spacing: -1px; line-height: 1; }
    .brand-tag { margin-top: 4px; color: #7b849a; font-size: 8px; font-weight: 700; letter-spacing: 2px; }
    .brand-side { margin-left: auto; color: #7b849a; font-size: 9px; font-weight: 700; letter-spacing: 1.8px; text-align: right; text-transform: uppercase; }
    h1 { margin: 18px 0 4px; font-size: 23px; letter-spacing: -.5px; }
    .subtitle { margin: 0; color: #68748b; font-size: 11px; }
    .meta { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 11px; color: #526078; font-size: 9px; }
    .meta b { color: #27334a; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin: 17px 0 20px; }
    .metric { padding: 11px 13px; border: 1px solid #e8e3ef; border-radius: 9px; background: #faf8fc; }
    .metric-value { font-size: 18px; font-weight: 700; line-height: 1.1; }
    .metric-label { margin-top: 5px; color: #6c7890; font-size: 8px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
    h2 { margin: 19px 0 8px; font-size: 13px; }
    .section-note { margin: -3px 0 8px; color: #737f95; font-size: 8px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th { padding: 7px 6px; color: #5c667c; background: #f3ecfb; font-size: 7px; letter-spacing: .5px; text-align: left; text-transform: uppercase; }
    td { padding: 7px 6px; border-bottom: 1px solid #e9eaf0; vertical-align: top; overflow-wrap: anywhere; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .strong { color: #202b40; font-weight: 700; }
    .muted { margin-top: 2px; color: #737f95; font-size: 8px; }
    .products { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
    .products li { display: flex; justify-content: space-between; gap: 8px; }
    .totals-note { margin-top: 5px; }
    .status { display: inline-block; padding: 3px 7px; border-radius: 20px; font-size: 7px; font-weight: 700; white-space: nowrap; }
    .complete { color: #08794e; background: #e4f7ee; }
    .reversed { color: #b42348; background: #fde9ee; }
    .status-note { max-width: 150px; }
    .empty { padding: 16px; color: #68748b; text-align: center; }
    .footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 18px; padding-top: 8px; border-top: 1px solid #e6e7ed; color: #798399; font-size: 8px; }
    .summary th:nth-child(1) { width: 29%; }
    .summary th:nth-child(2), .summary th:nth-child(3), .summary th:nth-child(5) { width: 10%; }
    .summary th:nth-child(4) { width: 15%; }
    .summary th:nth-child(6) { width: 26%; }
    .transactions th:nth-child(1) { width: 13%; }
    .transactions th:nth-child(2) { width: 16%; }
    .transactions th:nth-child(3) { width: 34%; }
    .transactions th:nth-child(4) { width: 9%; }
    .transactions th:nth-child(5) { width: 10%; }
    .transactions th:nth-child(6) { width: 10%; }
    .transactions th:nth-child(7) { width: 8%; }
    @media screen { body { padding: 24px; background: #f4f1f8; } .document { max-width: 1100px; margin: 0 auto; padding: 30px; background: white; box-shadow: 0 8px 40px #2a164012; } }
  </style>
</head>
<body>
  <main class="document">
    <header class="brand">
      <div class="logo">${pulseLogo()}</div>
      <div><div class="brand-name">Pulse</div><div class="brand-tag">PHARMACY NETWORK</div></div>
      <div class="brand-side">Official network report<br>All POS payment methods</div>
    </header>
    <h1>Sales Report</h1>
    <p class="subtitle">Pharmacy sales activity, item detail and payment summaries.</p>
    <div class="meta"><span><b>Period:</b> ${escapeHtml(rangeLabel)}</span><span><b>Pharmacy:</b> ${escapeHtml(pharmacyScope)}</span><span><b>Generated:</b> ${dateTime(generatedAt)}</span><span><b>Currency:</b> Zambian Kwacha (ZMW)</span></div>
    <section class="metrics" aria-label="Sales totals">
      <div class="metric"><div class="metric-value">${pharmacies.length}</div><div class="metric-label">Pharmacies in report</div></div>
      <div class="metric"><div class="metric-value">${sales.length.toLocaleString("en-US")}</div><div class="metric-label">POS transactions</div></div>
      <div class="metric"><div class="metric-value">${totalUnits.toLocaleString("en-US")}</div><div class="metric-label">Units sold</div></div>
      <div class="metric"><div class="metric-value">${money(totalRevenue)}</div><div class="metric-label">Net sales · ${reversalCount} reversed</div></div>
    </section>
    <section>
      <h2>Sales by pharmacy</h2>
      <p class="section-note">Net sales and units exclude reversed transactions; reversed receipts remain in transaction detail.</p>
      <table class="summary"><thead><tr><th>Pharmacy</th><th class="number">Transactions</th><th class="number">Units</th><th class="number">Net sales</th><th class="number">Reversed</th><th>Last sale</th></tr></thead><tbody>${summaryRows}</tbody></table>
    </section>
    <section>
      <h2>POS transaction detail</h2>
      <table class="transactions"><thead><tr><th>Date / receipt</th><th>Pharmacy / store</th><th>Products · quantity · unit price</th><th>Payment</th><th>Cashier</th><th class="number">Total</th><th>Status</th></tr></thead><tbody>${transactionRows}</tbody></table>
    </section>
    <footer class="footer"><span>Pulse · Pharmacy intelligence, delivered</span><span>Confidential sales report · ${dateTime(generatedAt)}</span></footer>
  </main>
</body>
</html>`;
}
