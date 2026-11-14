/* ------------------------------------------------------------------ */
/* Pulse pricing — one vocabulary for every portal                     */
/* ------------------------------------------------------------------ */
/* The network operates with three layers:                             */
/*   1. cost price      — what Duniya pays the supplier                */
/*   2. Duniya price    — cost + the standard markup (20% by default)  */
/*   3. retail price    — what the pharmacy chooses to charge patients */
/*                                                                     */
/* The pharmacy pays Duniya the Duniya price; its margin is the gap    */
/* between that and its own retail price. Keeping the maths here means */
/* the warehouse, pharmacy, stock requests and audits cannot disagree. */

export const DUNIYA_MARKUP_PERCENT = 20;

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function roundQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/** A markup is a percentage, clamped to a sane 0–100 range. */
export function normaliseMarkup(value: unknown, fallback = DUNIYA_MARKUP_PERCENT): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(100, Math.max(0, parsed)) * 100) / 100;
}

/** The Duniya price for one unit: supplier cost plus the agreed markup. */
export function duniyaUnitPrice(
  costPrice: number,
  markupPercent = DUNIYA_MARKUP_PERCENT
): number {
  const cost = Math.max(0, roundMoney(costPrice));
  const markup = normaliseMarkup(markupPercent);
  return roundMoney(cost * (1 + markup / 100));
}

/** Cost implied by a retail price and markup, used for legacy rows with no cost. */
export function impliedCostPrice(
  retailPrice: number,
  markupPercent = DUNIYA_MARKUP_PERCENT
): number {
  const retail = Math.max(0, roundMoney(retailPrice));
  const markup = normaliseMarkup(markupPercent);
  return roundMoney(retail / (1 + markup / 100));
}

export type PriceLayers = {
  costPrice: number;
  markupPercent: number;
  markupAmount: number;
  duniyaPrice: number;
  retailPrice: number;
  /** Retail minus Duniya — the pharmacy's cash margin per unit. */
  marginAmount: number;
  /** Margin as a percentage of the retail price. */
  marginPercent: number;
};

/** Every price layer for one unit, with the markup and margin derived. */
export function priceLayers(input: {
  costPrice: number;
  markupPercent?: number;
  retailPrice?: number;
}): PriceLayers {
  const costPrice = Math.max(0, roundMoney(input.costPrice));
  const markupPercent = normaliseMarkup(input.markupPercent);
  const duniyaPrice = duniyaUnitPrice(costPrice, markupPercent);
  const retailPrice = Math.max(0, roundMoney(input.retailPrice ?? 0));
  const marginAmount = roundMoney(Math.max(0, retailPrice - duniyaPrice));
  return {
    costPrice,
    markupPercent,
    markupAmount: roundMoney(duniyaPrice - costPrice),
    duniyaPrice,
    retailPrice,
    marginAmount,
    marginPercent:
      retailPrice > 0 ? Math.round((marginAmount / retailPrice) * 10000) / 100 : 0,
  };
}

/** `ZMW 1,240` for whole amounts, `ZMW 12.50` when cents matter. */
export function formatZmw(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const hasCents = Math.round(safe * 100) % 100 !== 0;
  return `ZMW ${safe.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
