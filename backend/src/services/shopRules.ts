import { ValidationError } from '../errors/httpErrors.js';

/** The documents 4VD numbers itself. */
export type NumberedKind = 'invoice' | 'credit_note' | 'offer';
export const NUMBERED_KINDS: NumberedKind[] = ['invoice', 'credit_note', 'offer'];

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
}

export const DEFAULT_RULES: ShopRules = {
  numbering: {
    invoice: { prefix: 'F', year: 'yyyy', digits: 6 },
    credit_note: { prefix: 'K', year: 'yyyy', digits: 6 },
    offer: { prefix: 'OF', year: 'yyyy', digits: 6 },
  },
  noStockSales: 'block',
};

const NUMBERING_KEY = 'numbering';
const NO_STOCK_KEY = 'no_stock_sales';

/** Reads the rules from the settings store, filling in what was never set. */
export async function readRules(settings: { all(): Promise<Map<string, unknown>> }): Promise<ShopRules> {
  const stored = await settings.all();
  const numbering = (stored.get(NUMBERING_KEY) ?? {}) as Partial<Record<NumberedKind, Partial<NumberFormat>>>;
  const noStock = stored.get(NO_STOCK_KEY);
  return {
    numbering: Object.fromEntries(NUMBERED_KINDS.map((kind) => [kind, { ...DEFAULT_RULES.numbering[kind], ...numbering[kind] }])) as ShopRules['numbering'],
    noStockSales: noStock === 'allow' ? 'allow' : 'block',
  };
}

export const RULE_KEYS = { numbering: NUMBERING_KEY, noStockSales: NO_STOCK_KEY } as const;

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
