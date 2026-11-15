import { ValidationError } from '../errors/httpErrors.js';
import { DEFAULT_SHORT_DATED, type ShortDatedRules } from './pricing/shortDated.js';

/** The documents 4VD numbers itself. */
export type NumberedKind = 'invoice' | 'credit_note' | 'offer' | 'stock_in' | 'stock_out' | 'stock_move';
export const NUMBERED_KINDS: NumberedKind[] = ['invoice', 'credit_note', 'offer', 'stock_in', 'stock_out', 'stock_move'];

/** How a number reads, like FSM-26-000001: prefix, the year in 2 or 4 digits, then the count. */
export interface NumberFormat {
  prefix: string;
  year: 'yy' | 'yyyy';
  digits: number;
}

export interface ShopRules {
  numbering: Record<NumberedKind, NumberFormat>;
  /**
   * Selling more than 4VD thinks is on the shelf. 'block' refuses it, unless
   * an owner or admin is selling (an employee switches to them with their PIN).
   * 'allow' sells it, takes stock to 0 and asks for a count, as offline sales do.
   */
  noStockSales: 'block' | 'allow';
  /** When stock counts as short-dated and how much comes off it. */
  shortDated: ShortDatedRules;
}

export const DEFAULT_RULES: ShopRules = {
  numbering: {
    invoice: { prefix: 'F', year: 'yyyy', digits: 6 },
    credit_note: { prefix: 'K', year: 'yyyy', digits: 6 },
    offer: { prefix: 'OF', year: 'yyyy', digits: 6 },
    // Hyrje and Dalje, as Albanian books call stock in and out.
    stock_in: { prefix: 'HY', year: 'yyyy', digits: 6 },
    stock_out: { prefix: 'DA', year: 'yyyy', digits: 6 },
    // Lëvizje (a move between locations).
    stock_move: { prefix: 'LV', year: 'yyyy', digits: 6 },
  },
  noStockSales: 'block',
  shortDated: DEFAULT_SHORT_DATED,
};

const NUMBERING_KEY = 'numbering';
const NO_STOCK_KEY = 'no_stock_sales';
const SHORT_DATED_KEY = 'short_dated';

/** Reads the rules from the settings store, filling in what was never set. */
export async function readRules(settings: { all(): Promise<Map<string, unknown>> }): Promise<ShopRules> {
  const stored = await settings.all();
  const numbering = (stored.get(NUMBERING_KEY) ?? {}) as Partial<Record<NumberedKind, Partial<NumberFormat>>>;
  const noStock = stored.get(NO_STOCK_KEY);
  const shortDated = (stored.get(SHORT_DATED_KEY) ?? {}) as Partial<ShortDatedRules>;
  return {
    numbering: Object.fromEntries(NUMBERED_KINDS.map((kind) => [kind, { ...DEFAULT_RULES.numbering[kind], ...numbering[kind] }])) as ShopRules['numbering'],
    noStockSales: noStock === 'allow' ? 'allow' : 'block',
    shortDated: { ...DEFAULT_SHORT_DATED, ...shortDated },
  };
}

export const RULE_KEYS = { numbering: NUMBERING_KEY, noStockSales: NO_STOCK_KEY, shortDated: SHORT_DATED_KEY } as const;

/** "FSM-26-000001". The count grows past `digits` rather than wrap. */
export function formatNumber(format: NumberFormat, year: number, count: number): string {
  const y = format.year === 'yy' ? String(year % 100).padStart(2, '0') : String(year);
  return `${format.prefix}-${y}-${String(count).padStart(format.digits, '0')}`;
}

/** Two kinds with the same prefix and year would print the same number. */
export function checkNumbering(numbering: ShopRules['numbering']): void {
  const seen = new Map<string, NumberedKind>();
  for (const kind of NUMBERED_KINDS) {
    const key = numbering[kind].prefix;
    const other = seen.get(key);
    if (other) throw new ValidationError(`numbering: ${kind} and ${other} can't both start with ${key}`);
    seen.set(key, kind);
  }
}
