import type { AccountLinkKey } from '../../constants/chartOfAccounts.js';
import { roundMoney } from '../../utils/money.js';

/** One debit or credit line, before it is written. */
export interface DraftLine {
  accountId: number;
  debit: number;
  credit: number;
  supplierId: number | null;
  customerId: number | null;
}

/** What a document should have posted: null when it posts nothing (undone, voided, not approved, before the books start). */
export interface DraftEntry {
  date: string;
  /** The reference shown after the kind of entry: an invoice number, a supplier, a product. */
  description: string;
  /** A code the screens turn into words, e.g. "no_cost:2" (2 products had no cost). */
  warning: string | null;
  lines: DraftLine[];
}

export type AccountLinks = Record<AccountLinkKey, number>;

interface Party {
  supplierId?: number | null;
  customerId?: number | null;
}

/**
 * The part of a sale's price that is VAT, for a VAT-inclusive amount. The net
 * part is what's left, so net + VAT always equals the gross to the cent.
 */
export function vatOf(gross: number, ratePercent: number): number {
  return roundMoney((gross * ratePercent) / (100 + ratePercent));
}

/**
 * Collects debits and credits for one entry, merging lines on the same account
 * and party, and refuses to finish an entry that doesn't balance (a bug, never
 * something a person can cause).
 */
export class EntryBuilder {
  private readonly lines = new Map<string, DraftLine>();

  constructor(private readonly links: AccountLinks) {}

  debit(account: AccountLinkKey, amount: number, party: Party = {}): this {
    return this.add(account, roundMoney(amount), party);
  }

  credit(account: AccountLinkKey, amount: number, party: Party = {}): this {
    return this.add(account, -roundMoney(amount), party);
  }

  private add(account: AccountLinkKey, signed: number, party: Party): this {
    if (signed === 0) return this;
    const accountId = this.links[account];
    const supplierId = party.supplierId ?? null;
    const customerId = party.customerId ?? null;
    const key = `${accountId}/${supplierId}/${customerId}`;
    const line = this.lines.get(key) ?? { accountId, debit: 0, credit: 0, supplierId, customerId };
    const net = roundMoney(line.debit - line.credit + signed);
    line.debit = net > 0 ? net : 0;
    line.credit = net < 0 ? -net : 0;
    this.lines.set(key, line);
    return this;
  }

  /** The finished entry, or null when every line cancelled out. */
  build(date: string, description: string, warning: string | null = null): DraftEntry | null {
    const lines = [...this.lines.values()].filter((line) => line.debit > 0 || line.credit > 0);
    if (lines.length === 0) return null;
    const debits = roundMoney(lines.reduce((sum, line) => sum + line.debit, 0));
    const credits = roundMoney(lines.reduce((sum, line) => sum + line.credit, 0));
    if (debits !== credits) throw new Error(`Entry "${description}" doesn't balance: debits ${debits}, credits ${credits}`);
    // Debits first, then by account, so the same entry always reads (and fingerprints) the same.
    lines.sort((a, b) => b.debit - a.debit || a.accountId - b.accountId || (a.supplierId ?? 0) - (b.supplierId ?? 0) || (a.customerId ?? 0) - (b.customerId ?? 0));
    return { date, description: description.slice(0, 500), warning, lines };
  }
}

/** The lines and day in a stable form: equal fingerprints mean the posted entry is still right. */
export function fingerprintOf(entry: DraftEntry): string {
  return JSON.stringify([entry.date, entry.lines.map((line) => [line.accountId, line.debit, line.credit, line.supplierId, line.customerId])]);
}
