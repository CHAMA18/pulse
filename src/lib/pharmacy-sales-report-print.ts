/* ------------------------------------------------------------------ */
/* Pulse — branded Sales Report document (print / save as PDF)          */
/* ------------------------------------------------------------------ */
/* One self-contained HTML document, styled for A4 portrait printing.  */
/* The on-screen preview carries the same Pulse identity as the portal */
/* while @media print strips the toolbar and tightens the layout.      */

type ReportLine = {
  productId?: string;
  name: string;
  qty: number;
  unitPrice: number;
};

type ReportSale = {
  id: string;
  soldAt: number;
  method: string;
  subtotal: number;
  discount: number;
  total: number;
  servedBy: string;
  storeName?: string;
  storeId?: string;
  lines: ReportLine[];
};

export type PharmacySalesReportPrintInput = {
  /** Completed sales in the selected range — reversed sales are never passed. */
  sales: ReportSale[];
  pharmacyName: string;
  /** "All stores" or the selected storefront's name. */
  storeScope: string;
  scopeAllStores: boolean;
  /** "Today", "This week", "This month" or "Custom range". */
  periodLabel: string;
  /** Human date range, e.g. "1 Nov 2026 – 13 Nov 2026". */
  rangeLabel: string;
  startAt: number;
  /** Exclusive end of the report range. */
  endExclusive: number;
  generatedAt: number;
  preparedBy?: string;
};

const PAYMENT_METHODS = [
  { id: "cash", label: "Cash" },
  { id: "mobile", label: "Mobile money" },
  { id: "card", label: "Card" },
] as const;

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
  return `ZMW ${Math.round(value).toLocaleString("en-US")}`;
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

function dayLabel(value: number): string {
  return new Intl.DateTimeFormat("en-ZM", {
    day: "numeric",
    month: "short",
  }).format(value);
}

function paymentName(method: string): string {
  return method === "mobile" ? "Mobile money" : method === "card" ? "Card" : "Cash";
}

function reportId(generatedAt: number): string {
  const date = new Date(generatedAt);
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate()
  ).padStart(2, "0")}`;
  return `SR-${stamp}-${generatedAt.toString(36).slice(-4).toUpperCase()}`;
}

function share(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function pulseMark(): string {
  return `<svg width="26" height="26" viewBox="0 0 64 64" role="img" aria-label="Pulse logo" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="pulse-print-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#d946ef"/><stop offset=".5" stop-color="#b026ff"/><stop offset="1" stop-color="#8b2fe8"/></linearGradient></defs>
    <g stroke="url(#pulse-print-g)" stroke-width="2" opacity=".5" fill="none"><line x1="32" y1="7" x2="50" y2="16"/><line x1="50" y1="16" x2="57" y2="32"/><line x1="57" y1="32" x2="50" y2="48"/><line x1="50" y1="48" x2="32" y2="57"/><line x1="32" y1="57" x2="14" y2="48"/><line x1="14" y1="48" x2="7" y2="32"/><line x1="7" y1="32" x2="14" y2="16"/><line x1="14" y1="16" x2="32" y2="7"/></g>
    <g fill="url(#pulse-print-g)"><circle cx="32" cy="7" r="4.4"/><circle cx="50" cy="16" r="4.4"/><circle cx="57" cy="32" r="4.4"/><circle cx="50" cy="48" r="4.4"/><circle cx="32" cy="57" r="4.4"/><circle cx="14" cy="48" r="4.4"/><circle cx="7" cy="32" r="4.4"/><circle cx="14" cy="16" r="4.4"/></g>
    <polyline points="6,32 22,32 27,23 32,41 36,16 41,34 44,32 58,32" fill="none" stroke="url(#pulse-print-g)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dailyBuckets(
  startAt: number,
  endExclusive: number,
  sales: ReportSale[]
): { at: number; total: number }[] {
  const byDay = new Map<string, number>();
  for (const sale of sales) {
    const key = dayKey(new Date(sale.soldAt));
    byDay.set(key, (byDay.get(key) ?? 0) + sale.total);
  }
  const buckets: { at: number; total: number }[] = [];
  const cursor = new Date(startAt);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < endExclusive && buckets.length < 400) {
    buckets.push({ at: cursor.getTime(), total: byDay.get(dayKey(cursor)) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}

export function buildPharmacySalesReportHtml(input: PharmacySalesReportPrintInput): string {
  const {
    sales,
    pharmacyName,
    storeScope,
    scopeAllStores,
    periodLabel,
    rangeLabel,
    startAt,
    endExclusive,
    generatedAt,
    preparedBy,
  } = input;

  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
  const units = sales.reduce(
    (sum, sale) => sum + sale.lines.reduce((lineSum, line) => lineSum + line.qty, 0),
    0
  );
  const average = sales.length > 0 ? revenue / sales.length : 0;
  const docId = reportId(generatedAt);

  /* Payment mix ------------------------------------------------------ */
  const paymentRows = PAYMENT_METHODS.map(({ id, label }) => {
    const methodSales = sales.filter((sale) => sale.method === id);
    const amount = methodSales.reduce((sum, sale) => sum + sale.total, 0);
    return {
      id,
      label,
      amount,
      transactions: methodSales.length,
      percent: share(amount, revenue),
    };
  });

  /* Stores (only meaningful when the whole account is in scope) ------ */
  const storeMap = new Map<string, { name: string; transactions: number; units: number; revenue: number }>();
  for (const sale of sales) {
    const name = sale.storeName?.trim() || sale.storeId || "Main store";
    const entry = storeMap.get(name) ?? { name, transactions: 0, units: 0, revenue: 0 };
    entry.transactions += 1;
    entry.units += sale.lines.reduce((sum, line) => sum + line.qty, 0);
    entry.revenue += sale.total;
    storeMap.set(name, entry);
  }
  const storeRows = Array.from(storeMap.values()).sort(
    (a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name)
  );

  /* Product performance ---------------------------------------------- */
  /* Line revenue is net of order discounts, allocated proportionally so
     product totals reconcile exactly with the report's net revenue.     */
  const productMap = new Map<string, { name: string; units: number; revenue: number }>();
  for (const sale of sales) {
    const factor = sale.subtotal > 0 ? Math.max(0, Math.min(1, sale.total / sale.subtotal)) : 0;
    for (const line of sale.lines) {
      const key = line.productId ?? line.name;
      const entry = productMap.get(key) ?? { name: line.name, units: 0, revenue: 0 };
      entry.units += line.qty;
      entry.revenue += line.qty * line.unitPrice * factor;
      productMap.set(key, entry);
    }
  }
  const productRows = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units || a.name.localeCompare(b.name))
    .slice(0, 10);

  /* Daily chart ------------------------------------------------------- */
  const buckets = dailyBuckets(startAt, endExclusive, sales);
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.total), 0);
  const hasChartData = sales.length > 0 && peak > 0;
  const labelStep = Math.max(1, Math.ceil(buckets.length / 8));
  const chartBody = hasChartData
    ? `<div class="chart-bars" role="img" aria-label="Daily net revenue for ${escapeHtml(
        rangeLabel
      )}">
        ${buckets
          .map((bucket) => {
            const height = bucket.total > 0 ? Math.max(4, Math.round((bucket.total / peak) * 100)) : 0;
            return `<span class="bar${bucket.total > 0 ? "" : " zero"}" title="${escapeHtml(
              `${dayLabel(bucket.at)} · ${money(bucket.total)}`
            )}"><i style="height:${height}%"></i></span>`;
          })
          .join("")}
      </div>
      <div class="chart-labels" aria-hidden="true">
        ${buckets
          .map((bucket, index) =>
            index % labelStep === 0
              ? `<span>${escapeHtml(dayLabel(bucket.at))}</span>`
              : `<span>&nbsp;</span>`
          )
          .join("")}
      </div>`
    : `<div class="chart-empty">No completed sales were recorded in this period.</div>`;

  /* Tables ------------------------------------------------------------ */
  const storeTable = storeRows.length
    ? `<table class="store-table">
        <colgroup><col style="width:34%"><col style="width:14%"><col style="width:14%"><col style="width:20%"><col style="width:18%"></colgroup>
        <thead><tr><th>Store</th><th class="number">Sales</th><th class="number">Units</th><th class="number">Net revenue</th><th>Share of revenue</th></tr></thead>
        <tbody>${storeRows
          .map((store) => {
            const percent = share(store.revenue, revenue);
            return `<tr>
              <td><span class="strong">${escapeHtml(store.name)}</span></td>
              <td class="number">${store.transactions.toLocaleString("en-US")}</td>
              <td class="number">${store.units.toLocaleString("en-US")}</td>
              <td class="number strong">${money(store.revenue)}</td>
              <td><div class="mini-track"><i style="width:${percent}%"></i></div><span class="mini-label">${percent}%</span></td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>`
    : `<p class="empty">No completed sales were recorded for this period.</p>`;

  const productTable = productRows.length
    ? `<table class="product-table">
        <colgroup><col style="width:44%"><col style="width:12%"><col style="width:22%"><col style="width:22%"></colgroup>
        <thead><tr><th>Product</th><th class="number">Units</th><th class="number">Net revenue</th><th>Share of revenue</th></tr></thead>
        <tbody>${productRows
          .map((product) => {
            const percent = share(product.revenue, revenue);
            return `<tr>
              <td><span class="strong">${escapeHtml(product.name)}</span></td>
              <td class="number">${product.units.toLocaleString("en-US")}</td>
              <td class="number strong">${money(product.revenue)}</td>
              <td><div class="mini-track"><i style="width:${percent}%"></i></div><span class="mini-label">${percent}%</span></td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>`
    : `<p class="empty">No product lines were sold in this period.</p>`;

  const registerRows = sales.length
    ? sales
        .slice()
        .sort((a, b) => b.soldAt - a.soldAt)
        .map((sale) => {
          const saleUnits = sale.lines.reduce((sum, line) => sum + line.qty, 0);
          const discountNote =
            sale.discount > 0 ? `<div class="muted">Discount ${money(sale.discount)}</div>` : "";
          return `<tr>
            <td><span class="mono">${escapeHtml(sale.id)}</span></td>
            <td>${escapeHtml(dateTime(sale.soldAt))}</td>
            ${scopeAllStores ? `<td>${escapeHtml(sale.storeName?.trim() || sale.storeId || "Main store")}</td>` : ""}
            <td>${escapeHtml(sale.servedBy || "—")}</td>
            <td class="number">${saleUnits.toLocaleString("en-US")}</td>
            <td>${escapeHtml(paymentName(sale.method))}</td>
            <td class="number"><span class="strong">${money(sale.total)}</span>${discountNote}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="${scopeAllStores ? 7 : 6}" class="empty">No completed transactions were recorded for this period.</td></tr>`;

  const metaItems = [
    { label: "Period", value: rangeLabel },
    { label: "Basis", value: periodLabel },
    { label: "Store scope", value: storeScope },
    { label: "Prepared by", value: preparedBy?.trim() || "Pharmacy team" },
    { label: "Generated", value: dateTime(generatedAt) },
    { label: "Currency", value: "Zambian Kwacha (ZMW)" },
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sales Report · ${escapeHtml(pharmacyName)} · ${escapeHtml(rangeLabel)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 12mm 20mm; }
    * { box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #fff; color: #1c1526; font: 10px/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif; }
    .document { width: 100%; max-width: 780px; margin: 0 auto; }

    /* Masthead */
    .masthead { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding-bottom: 12px; }
    .brand { display: flex; align-items: center; gap: 9px; }
    .brand-mark { display: grid; width: 40px; height: 40px; place-items: center; border: 1px solid #efdffb; border-radius: 12px; background: linear-gradient(140deg, #fdf5ff, #f4e9ff); }
    .brand-name { color: #a414ec; font-size: 22px; font-weight: 700; letter-spacing: -.7px; line-height: 1; }
    .brand-sub { margin-top: 4px; color: #8a7a9c; font-size: 7px; font-weight: 700; letter-spacing: 2.2px; text-transform: uppercase; }
    .masthead-side { padding-top: 2px; text-align: right; }
    .doc-kind { color: #6d5e7f; font-size: 7.5px; font-weight: 700; letter-spacing: 1.7px; text-transform: uppercase; }
    .doc-id { margin-top: 5px; color: #3d2b52; font: 700 9px/1 Menlo, Consolas, monospace; letter-spacing: .4px; }
    .rule { height: 3px; border-radius: 999px; background: linear-gradient(90deg, #d946ef, #a414ec 46%, #5b21b6 100%); }

    /* Title */
    .title-block { padding: 16px 0 2px; }
    .eyebrow { margin: 0 0 5px; color: #a414ec; font-size: 7.5px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
    h1 { margin: 0; color: #170d24; font-size: 28px; font-weight: 700; letter-spacing: -.9px; line-height: 1.05; }
    .subtitle { margin: 6px 0 0; color: #6a5c7c; font-size: 10px; }
    .pharmacy-line { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 9px; }
    .pharmacy-name { color: #2c1c3f; font-size: 10px; font-weight: 700; }
    .pharmacy-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: 1px solid #e9d9f8; border-radius: 999px; color: #7c3aed; background: #faf5ff; font-size: 7.5px; font-weight: 700; letter-spacing: .4px; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px 18px; margin: 13px 0 0; padding: 11px 13px; border: 1px solid #eee6f7; border-radius: 10px; background: #fbf8fe; list-style: none; }
    .meta li { min-width: 0; }
    .meta span { display: block; color: #9686a8; font-size: 6.8px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    .meta strong { display: block; margin-top: 2px; color: #2c1c3f; font-size: 8.8px; font-weight: 600; overflow-wrap: anywhere; }

    /* Revenue hero */
    .hero { display: grid; grid-template-columns: 1.4fr 1fr; overflow: hidden; margin-top: 16px; border-radius: 14px; background: linear-gradient(135deg, #2b0b45 0%, #5b1299 58%, #a414ec 100%); color: #fff; page-break-inside: avoid; break-inside: avoid; }
    .hero-main { padding: 16px 18px 15px; }
    .hero-label { margin: 0; color: rgba(255,255,255,.74); font-size: 7.5px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; }
    .hero-value { margin: 6px 0 0; font-size: 29px; font-weight: 700; letter-spacing: -1px; line-height: 1; font-variant-numeric: tabular-nums; }
    .hero-note { margin: 7px 0 0; color: rgba(255,255,255,.72); font-size: 8px; }
    .hero-side { display: grid; grid-template-rows: repeat(3, 1fr); border-left: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.075); }
    .hero-stat { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 14px; border-top: 1px solid rgba(255,255,255,.1); }
    .hero-stat:first-child { border-top: 0; }
    .hero-stat span { color: rgba(255,255,255,.72); font-size: 8px; }
    .hero-stat strong { font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }

    /* Sections */
    .section { margin-top: 17px; page-break-inside: avoid; break-inside: avoid; }
    .section-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 12px; margin-bottom: 7px; }
    h2 { margin: 0; color: #1f1230; font-size: 12px; font-weight: 700; letter-spacing: -.1px; }
    .section-note { margin: 2px 0 0; color: #8a7a9c; font-size: 7.6px; }
    .section-tag { padding: 2px 7px; border: 1px solid #ece2f7; border-radius: 999px; color: #7a6890; background: #fbf7ff; font-size: 7px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }

    /* Payment mix */
    .pay-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .pay-card { padding: 10px 11px 9px; border: 1px solid #eee6f7; border-radius: 10px; background: #fff; }
    .pay-top { display: flex; align-items: center; gap: 6px; color: #5a4b6d; font-size: 7.6px; font-weight: 700; letter-spacing: .7px; text-transform: uppercase; }
    .dot { width: 7px; height: 7px; border-radius: 50%; }
    .dot.cash { background: #059669; }
    .dot.mobile { background: #7c3aed; }
    .dot.card { background: #d946ef; }
    .pay-value { margin-top: 5px; color: #1f1230; font-size: 13px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .pay-share { height: 4px; margin-top: 7px; overflow: hidden; border-radius: 99px; background: #f1eaf9; }
    .pay-share i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #c026d3, #8b2fe8); }
    .pay-meta { margin-top: 5px; color: #8a7a9c; font-size: 7.4px; }

    /* Chart */
    .chart { padding: 12px 13px 10px; border: 1px solid #eee6f7; border-radius: 12px; background: linear-gradient(180deg, #fff, #fdfbff); }
    .chart-bars { display: flex; align-items: flex-end; gap: 2px; height: 98px; background: repeating-linear-gradient(180deg, transparent 0, transparent 23px, #f3edfa 24px); }
    .bar { display: flex; flex: 1; flex-direction: column; justify-content: flex-end; height: 100%; min-width: 1px; }
    .bar i { display: block; border-radius: 3px 3px 1px 1px; background: linear-gradient(180deg, #e879f9, #8b2fe8); }
    .bar.zero i { height: 2px !important; background: #eee4f9; }
    .chart-labels { display: flex; gap: 2px; margin-top: 5px; }
    .chart-labels span { flex: 1; min-width: 0; overflow: hidden; color: #9a8aab; font-size: 6.4px; text-align: center; white-space: nowrap; }
    .chart-empty { display: grid; height: 70px; place-items: center; border: 1px dashed #e9def6; border-radius: 8px; color: #8a7a9c; background: #fdfbff; font-size: 8.5px; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th { padding: 6px; border-bottom: 1px solid #ece2f7; background: #f6f0fc; color: #7a6890; font-size: 6.8px; font-weight: 700; letter-spacing: .8px; text-align: left; text-transform: uppercase; }
    td { padding: 6px; border-bottom: 1px solid #f2ecf9; vertical-align: top; overflow-wrap: anywhere; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .strong { color: #221533; font-weight: 700; }
    .muted { margin-top: 2px; color: #8a7a9c; font-size: 7.2px; }
    .mono { color: #5b4a70; font: 600 7.4px/1.3 Menlo, Consolas, monospace; letter-spacing: -.2px; }
    .mini-track { height: 4px; margin-top: 3px; overflow: hidden; border-radius: 99px; background: #f2ecfa; }
    .mini-track i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #c026d3, #8b2fe8); }
    .mini-label { display: block; margin-top: 3px; color: #8a7a9c; font-size: 6.8px; font-variant-numeric: tabular-nums; }
    .empty { padding: 14px; border: 1px dashed #e7dcf4; border-radius: 10px; color: #8a7a9c; background: #fcfaff; font-size: 9px; text-align: center; }
    td.empty { border: 0; }

    /* Footer */
    .page-footer { position: fixed; right: 0; bottom: 0; left: 0; display: flex; justify-content: space-between; gap: 16px; padding-top: 6px; border-top: 1px solid #eedff9; color: #9a8aab; font-size: 6.8px; }
    .page-footer b { color: #7c3aed; font-weight: 700; }

    /* Screen preview */
    @media screen {
      body { padding: 32px 16px 44px; background: radial-gradient(1000px 500px at 50% -10%, #f3e9ff, #f6f2fa 40%, #f2edf7 100%); }
      .document { max-width: 820px; padding: 34px 38px 30px; border-radius: 18px; background: #fff; box-shadow: 0 30px 80px -34px rgba(54,20,84,.4); }
      .page-footer { position: static; margin-top: 26px; }
    }
    .toolbar { position: fixed; top: 16px; right: 16px; display: flex; align-items: center; gap: 10px; padding: 7px 7px 7px 14px; border: 1px solid #eee6f7; border-radius: 999px; background: #fff; box-shadow: 0 14px 32px -16px rgba(54,20,84,.35); }
    .toolbar-hint { color: #7a6890; font-size: 10.5px; font-weight: 600; }
    .toolbar button { padding: 8px 16px; border: 0; border-radius: 999px; color: #fff; background-image: linear-gradient(112deg, #c026d3, #b026ff 52%, #9333ea); cursor: pointer; font: 700 10.5px/1 "Helvetica Neue", Helvetica, Arial, sans-serif; }
    @media print { .toolbar { display: none !important; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="toolbar-hint">Preview · save as PDF</span>
    <button type="button" onclick="window.print()">Save as PDF</button>
  </div>

  <main class="document">
    <header class="masthead">
      <div class="brand">
        <span class="brand-mark">${pulseMark()}</span>
        <div>
          <div class="brand-name">Pulse</div>
          <div class="brand-sub">Pharmacy Portal</div>
        </div>
      </div>
      <div class="masthead-side">
        <div class="doc-kind">Sales report</div>
        <div class="doc-id">${docId}</div>
      </div>
    </header>
    <div class="rule"></div>

    <section class="title-block">
      <p class="eyebrow">Sales performance</p>
      <h1>Sales Report</h1>
      <p class="subtitle">Completed sales for ${escapeHtml(storeScope.toLowerCase())}; reversed sales are excluded.</p>
      <div class="pharmacy-line">
        <span class="pharmacy-name">${escapeHtml(pharmacyName)}</span>
        <span class="pharmacy-chip">${scopeAllStores ? "All stores" : escapeHtml(storeScope)}</span>
      </div>
      <ul class="meta">
        ${metaItems
          .map(
            (item) =>
              `<li><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></li>`
          )
          .join("")}
      </ul>
    </section>

    <section class="hero" aria-label="Report highlights">
      <div class="hero-main">
        <p class="hero-label">Net revenue</p>
        <p class="hero-value">${money(revenue)}</p>
        <p class="hero-note">${escapeHtml(periodLabel)} · ${escapeHtml(rangeLabel)}</p>
      </div>
      <div class="hero-side">
        <div class="hero-stat"><span>Completed sales</span><strong>${sales.length.toLocaleString("en-US")}</strong></div>
        <div class="hero-stat"><span>Items sold</span><strong>${units.toLocaleString("en-US")}</strong></div>
        <div class="hero-stat"><span>Average sale</span><strong>${money(average)}</strong></div>
      </div>
    </section>

    <section class="section" aria-label="Revenue by payment method">
      <div class="section-head">
        <div>
          <h2>Revenue by payment method</h2>
          <p class="section-note">Net of discounts and excluding reversed transactions.</p>
        </div>
        <span class="section-tag">${escapeHtml(rangeLabel)}</span>
      </div>
      <div class="pay-grid">
        ${paymentRows
          .map(
            (method) => `<div class="pay-card">
              <div class="pay-top"><span class="dot ${method.id}"></span>${method.label}</div>
              <div class="pay-value">${money(method.amount)}</div>
              <div class="pay-share"><i style="width:${method.percent}%"></i></div>
              <div class="pay-meta">${method.percent}% of revenue · ${method.transactions} transaction${method.transactions === 1 ? "" : "s"}</div>
            </div>`
          )
          .join("")}
      </div>
    </section>

    <section class="section" aria-label="Daily revenue">
      <div class="section-head">
        <div>
          <h2>Revenue by day</h2>
          <p class="section-note">Daily net revenue across the selected range.</p>
        </div>
        <span class="section-tag">Peak ${money(peak)}</span>
      </div>
      <div class="chart">${chartBody}</div>
    </section>

    ${
      scopeAllStores
        ? `<section class="section" aria-label="Sales by store">
            <div class="section-head">
              <div>
                <h2>Sales by store</h2>
                <p class="section-note">How each storefront contributed to the selected period.</p>
              </div>
              <span class="section-tag">${storeRows.length} store${storeRows.length === 1 ? "" : "s"}</span>
            </div>
            ${storeTable}
          </section>`
        : ""
    }

    <section class="section" aria-label="Top products">
      <div class="section-head">
        <div>
          <h2>Top products</h2>
          <p class="section-note">Net revenue after proportional discount allocation, top 10 products.</p>
        </div>
        <span class="section-tag">${productRows.length} product${productRows.length === 1 ? "" : "s"}</span>
      </div>
      ${productTable}
    </section>

    <section class="section" aria-label="Transaction register" style="break-inside:auto;page-break-inside:auto">
      <div class="section-head">
        <div>
          <h2>Transaction register</h2>
          <p class="section-note">Every completed receipt in the period, newest first. Reversed sales are excluded.</p>
        </div>
        <span class="section-tag">${sales.length} sale${sales.length === 1 ? "" : "s"}</span>
      </div>
      <table class="register-table">
        <colgroup>
          <col style="width:${scopeAllStores ? "13%" : "15%"}">
          <col style="width:${scopeAllStores ? "16%" : "19%"}">
          ${scopeAllStores ? `<col style="width:14%">` : ""}
          <col style="width:${scopeAllStores ? "15%" : "18%"}">
          <col style="width:7%">
          <col style="width:${scopeAllStores ? "11%" : "12%"}">
          <col style="width:${scopeAllStores ? "12%" : "13%"}">
        </colgroup>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Date &amp; time</th>
            ${scopeAllStores ? "<th>Store</th>" : ""}
            <th>Cashier</th>
            <th class="number">Units</th>
            <th>Payment</th>
            <th class="number">Total</th>
          </tr>
        </thead>
        <tbody>${registerRows}</tbody>
      </table>
    </section>

    <footer class="page-footer">
      <span><b>Pulse</b> · Pharmacy intelligence, delivered</span>
      <span>Confidential · ${escapeHtml(pharmacyName)} · ${docId}</span>
    </footer>
  </main>
</body>
</html>`;
}
