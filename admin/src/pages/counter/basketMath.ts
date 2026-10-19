import { afterDiscount, parsePercent, roundMoney, unitPriceFor } from '../../components/BasketForm';
import type { Product } from '../../services/types';
import type { StoredLine } from './useBaskets';

/** Why a line sells below its shelf price, strongest first: what the basket table writes under the name. */
export type PriceReason =
  | { kind: 'priceSet' }
  | { kind: 'rabat'; percent: number }
  | { kind: 'basketRabat'; percent: number }
  | { kind: 'promotion'; name: string }
  | { kind: 'bulk'; from: number };

export interface CounterLine extends StoredLine {
  product: Product | undefined;
  /** What one costs before any rabat: the shelf price, or the promotion's or bulk price. */
  listPrice: number;
  /** What one costs after the rabat. */
  unitPrice: number;
  total: number;
  /** The rabat in percent that applies: the line's own, else the basket's. */
  percent: number;
  reasons: PriceReason[];
  /** VAT included in the total, at the product's rate. */
  vat: number;
}

export interface BasketSummary {
  products: number;
  pieces: number;
  /** Every line at its list price. */
  subtotal: number;
  /** What the rabats take off the subtotal. */
  rabat: number;
  total: number;
  /** VAT included in the total, one entry per rate that has any, highest rate first. */
  vat: Array<{ rate: number; amount: number }>;
}

/** A line as the Counter shows it: its prices, the reasons for them, and its VAT. */
export function priceLine(line: StoredLine, product: Product | undefined, basketDiscount: string): CounterLine {
  const own = parsePercent(line.discount);
  const basket = parsePercent(basketDiscount);
  const percent = own > 0 ? own : basket;
  if (!product) return { ...line, product, listPrice: 0, unitPrice: 0, total: 0, percent, reasons: [], vat: 0 };

  const listPrice = unitPriceFor(product, line.quantity);
  const unitPrice = afterDiscount(listPrice, percent);
  const total = roundMoney(unitPrice * line.quantity);
  const reasons: PriceReason[] = [];
  if (own > 0) reasons.push(line.priceSet ? { kind: 'priceSet' } : { kind: 'rabat', percent: own });
  else if (basket > 0) reasons.push({ kind: 'basketRabat', percent: basket });
  if (product.promotion && listPrice === product.promotion.price && listPrice < product.price) reasons.push({ kind: 'promotion', name: product.promotion.name });
  else if (listPrice < product.price) {
    const tier = [...product.bulkPricingTiers].reverse().find((next) => line.quantity >= next.quantity);
    if (tier) reasons.push({ kind: 'bulk', from: tier.quantity });
  }
  const rate = product.vatExempt ? 0 : product.vatRate;
  const vat = roundMoney((total * rate) / (100 + rate));
  return { ...line, product, listPrice, unitPrice, total, percent, reasons, vat };
}

/** The receipt's foot: counts, the subtotal, what the rabat took off, and the VAT in the price. */
export function summarise(lines: CounterLine[]): BasketSummary {
  const total = roundMoney(lines.reduce((sum, line) => sum + line.total, 0));
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.listPrice * line.quantity, 0));
  const byRate = new Map<number, number>();
  for (const line of lines) {
    if (!line.product || line.vat === 0) continue;
    const rate = line.product.vatRate;
    byRate.set(rate, roundMoney((byRate.get(rate) ?? 0) + line.vat));
  }
  return {
    products: lines.length,
    pieces: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal,
    rabat: roundMoney(subtotal - total),
    total,
    vat: [...byRate].map(([rate, amount]) => ({ rate, amount })).sort((a, b) => b.rate - a.rate),
  };
}
