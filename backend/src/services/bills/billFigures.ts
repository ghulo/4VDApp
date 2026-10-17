import { type BillLineKind, SELF_CHARGE_VAT_RATE, WITHHOLDING_RATES, type WithholdingType } from '../../constants/bills.js';
import { roundMoney } from '../../utils/money.js';
import { vatOf } from '../books/entryBuilder.js';

export interface FigureLineInput {
  kind: BillLineKind;
  /** Products: how many, and the price for one as the paper shows it. */
  quantity?: number;
  unitPrice?: number;
  /** Costs and equipment: the line's amount as the paper shows it. */
  amount?: number;
  category?: string | null;
  vatRate: number;
  /** A product's own VAT rate, to turn its cost back into the VAT-inclusive cost 4VD keeps. */
  productVatRate?: number;
}

export interface FigureInput {
  abroad: boolean;
  pricesIncludeVat: boolean;
  withholdingType: WithholdingType | null;
  /** From the customs paper, for an import. */
  customs: { vat: number; duty: number } | null;
  lines: FigureLineInput[];
}

export interface LineFigures {
  net: number;
  vat: number;
  /** The net plus its share of the duty and transport (goods only; costs keep their net). */
  landed: number;
  spread: boolean;
  /** VAT charged to yourself on a service from abroad. */
  selfVat: number;
  /** A product's new cost for one, VAT included like every cost in 4VD; null for other lines. */
  unitCost: number | null;
}

export interface BillFigures {
  lines: LineFigures[];
  /** What the paper adds up to. */
  total: number;
  /** The VAT on the paper. */
  paperVat: number;
  /** Added to stock, at cost without VAT. */
  stock: number;
  /** Booked as costs, without VAT, per category. */
  costs: Record<string, number>;
  /** Booked as equipment (fixed assets), without VAT. */
  equipment: number;
  /** VAT the shop claims back: the paper's plus the customs VAT. */
  vatToClaim: number;
  /** VAT charged to yourself and claimed back at once. */
  selfVat: number;
  /** Paid at the border. */
  customs: number;
  withholdingRate: number;
  withheld: number;
  /** What the supplier is owed: the total less the tax held back. */
  owed: number;
}

/** True for a line whose goods' cost absorbs duty and transport on an import. */
const isGoods = (kind: BillLineKind) => kind === 'product' || kind === 'equipment';

/**
 * What a bill comes to and what it does, worked out the same way for the
 * preview, the save and the books. Every amount is rounded to the cent, and
 * shares are spread so they add up exactly (the last line takes the rounding).
 */
export function billFigures(input: FigureInput): BillFigures {
  const hasGoods = input.lines.some((line) => isGoods(line.kind));
  const lines: LineFigures[] = input.lines.map((line) => {
    const typed = line.kind === 'product' ? (line.quantity ?? 0) * (line.unitPrice ?? 0) : (line.amount ?? 0);
    // A supplier abroad charges no Kosovo VAT; the customs paper or the shop itself does.
    const rate = input.abroad ? 0 : line.vatRate;
    let net: number;
    let vat: number;
    if (input.pricesIncludeVat) {
      const gross = roundMoney(typed);
      vat = vatOf(gross, rate);
      net = roundMoney(gross - vat);
    } else {
      net = roundMoney(typed);
      vat = roundMoney((net * rate) / 100);
    }
    const spread = input.abroad && hasGoods && line.kind === 'cost' && line.category === 'transport';
    const selfVat = input.abroad && line.kind === 'cost' && !spread ? roundMoney((net * SELF_CHARGE_VAT_RATE) / 100) : 0;
    return { net, vat, landed: net, spread, selfVat, unitCost: null };
  });

  // Duty and transport onto the goods, by value.
  const pool = roundMoney((input.abroad ? (input.customs?.duty ?? 0) : 0) + lines.filter((line) => line.spread).reduce((sum, line) => sum + line.net, 0));
  const goods = lines.map((line, index) => ({ line, index })).filter(({ index }) => isGoods(input.lines[index]!.kind));
  const goodsValue = goods.reduce((sum, { line }) => sum + line.net, 0);
  if (pool > 0 && goods.length > 0) {
    let left = pool;
    goods.forEach(({ line }, position) => {
      const share = position === goods.length - 1 ? left : roundMoney(goodsValue > 0 ? (pool * line.net) / goodsValue : pool / goods.length);
      line.landed = roundMoney(line.net + share);
      left = roundMoney(left - share);
    });
  }
  input.lines.forEach((line, index) => {
    const figures = lines[index]!;
    if (line.kind === 'product' && line.quantity) {
      const rate = line.productVatRate ?? line.vatRate;
      figures.unitCost = roundMoney((figures.landed / line.quantity) * (1 + rate / 100));
    }
  });

  const sum = (pick: (line: LineFigures, index: number) => number) => roundMoney(lines.reduce((total, line, index) => total + pick(line, index), 0));
  const kindOf = (index: number) => input.lines[index]!.kind;
  const costs: Record<string, number> = {};
  lines.forEach((line, index) => {
    if (kindOf(index) !== 'cost' || line.spread) return;
    const category = input.lines[index]!.category ?? 'other';
    costs[category] = roundMoney((costs[category] ?? 0) + line.net);
  });
  const total = sum((line) => line.net + line.vat);
  const withholdingRate = input.withholdingType ? WITHHOLDING_RATES[input.withholdingType] : 0;
  // Held back from what the supplier earns, VAT left out.
  const withheld = roundMoney((sum((line) => line.net) * withholdingRate) / 100);
  const customsVat = input.abroad ? (input.customs?.vat ?? 0) : 0;
  return {
    lines,
    total,
    paperVat: sum((line) => line.vat),
    stock: sum((line, index) => (kindOf(index) === 'product' ? line.landed : 0)),
    costs,
    equipment: sum((line, index) => (kindOf(index) === 'equipment' ? line.landed : 0)),
    vatToClaim: roundMoney(sum((line) => line.vat) + customsVat),
    selfVat: sum((line) => line.selfVat),
    customs: input.abroad ? roundMoney(customsVat + (input.customs?.duty ?? 0)) : 0,
    withholdingRate,
    withheld,
    owed: roundMoney(total - withheld),
  };
}

/**
 * A shelf price that keeps the old margin on a new cost, rounded up to a price
 * people are used to seeing: in 5 cents under €10 (1.37 → 1.39, 1.40 → 1.44),
 * in 50 cents under €100 (25.30 → 25.49), else in whole euros (118 → 118.99).
 */
export function priceKeepingMargin(oldCost: number, oldPrice: number, newCost: number): number {
  if (oldPrice <= 0 || oldCost >= oldPrice) return roundMoney(newCost);
  const margin = (oldPrice - oldCost) / oldPrice;
  const cents = Math.ceil((newCost / (1 - margin)) * 100 - 1e-6);
  const step = cents < 1_000 ? 5 : cents < 10_000 ? 50 : 100;
  return (Math.ceil((cents + 1) / step) * step - 1) / 100;
}
