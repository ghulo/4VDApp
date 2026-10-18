import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './trefinImport.js';

/** TREFIN's journal and the purchases, in the export folder. */
const JOURNAL = path.join('raw', 'MARKET_2025', 'tblDitari.csv');
const PURCHASES = 'purchases.csv';

/** TREFIN's account numbers for what suppliers and customers owe. */
const PAYABLES = '2000';
const RECEIVABLES = '1230';

export interface TrefinPurchase {
  supplierCode: string;
  number: string;
  day: string;
  total: number;
}

/** What TREFIN's books said on the evening before the books start. Every amount is debits minus credits. */
export interface TrefinOpening {
  /** The day the books start: everything dated before it counts. */
  day: string;
  /** Balance-sheet accounts (classes 1-3) by number. Payables and receivables are split by partner below. */
  accounts: Map<string, number>;
  /** Income and costs (classes 4-8) in the start day's year so far, and in the years before. */
  profitThisYear: number;
  profitEarlier: number;
  suppliers: Map<string, number>;
  customers: Map<string, number>;
  /** Payables and receivables with no partner on the line. */
  payablesWithoutPartner: number;
  receivablesWithoutPartner: number;
  /** Debits minus credits of every line read: 0 when TREFIN's books balance. */
  off: number;
  /** Purchase invoices before the day, newest first. */
  purchases: TrefinPurchase[];
}

const money = (value: number) => Math.round(value * 100) / 100;
const num = (value: string | undefined) => (value === undefined || value.trim() === '' ? 0 : Number(value));
const clean = (value: string | undefined) => (value ?? '').trim();

/**
 * Work out TREFIN's balances on the day before `day` from its journal (every
 * line up to then), and its purchase invoices, so the open supplier bills can
 * be told apart. Pure: the rows go in, the figures come out.
 */
export function trefinOpening(journal: Array<Record<string, string>>, purchaseRows: Array<Record<string, string>>, day: string): TrefinOpening {
  const accounts = new Map<string, number>();
  const suppliers = new Map<string, number>();
  const customers = new Map<string, number>();
  const year = day.slice(0, 4);
  let profitThisYear = 0;
  let profitEarlier = 0;
  let payablesWithoutPartner = 0;
  let receivablesWithoutPartner = 0;
  let off = 0;
  const add = (map: Map<string, number>, key: string, amount: number) => map.set(key, (map.get(key) ?? 0) + amount);

  for (const row of journal) {
    const date = clean(row.Data).slice(0, 10);
    if (!date || date >= day) continue;
    const account = clean(row.NrLlog);
    const amount = num(row.Debi) - num(row.Kredi);
    if (!account || amount === 0) continue;
    off += amount;
    const partner = clean(row.NrKlient);
    const hasPartner = partner !== '' && partner !== '0';
    if (Number(account[0]) >= 4) {
      if (date.slice(0, 4) === year) profitThisYear += amount;
      else profitEarlier += amount;
    } else if (account === PAYABLES) {
      if (hasPartner) add(suppliers, partner, amount);
      else payablesWithoutPartner += amount;
    } else if (account === RECEIVABLES) {
      if (hasPartner) add(customers, partner, amount);
      else receivablesWithoutPartner += amount;
    } else add(accounts, account, amount);
  }

  const documents = new Map<string, TrefinPurchase>();
  for (const row of purchaseRows) {
    const date = clean(row.purchase_date).slice(0, 10);
    if (!date || date >= day || !clean(row.doc_type).startsWith('FB')) continue;
    const key = `${clean(row.source_db)}:${clean(row.doc_id)}`;
    const document = documents.get(key) ?? { supplierCode: clean(row.supplier_code), number: clean(row.document_number), day: date, total: 0 };
    document.total += num(row.line_total);
    documents.set(key, document);
  }
  const purchases = [...documents.values()]
    .map((document) => ({ ...document, total: money(document.total) }))
    .filter((document) => document.total > 0)
    .sort((a, b) => (a.day === b.day ? b.number.localeCompare(a.number, undefined, { numeric: true }) : a.day < b.day ? 1 : -1));

  const rounded = (map: Map<string, number>) => new Map([...map].map(([key, value]) => [key, money(value)] as const).filter(([, value]) => value !== 0));
  return {
    day,
    accounts: rounded(accounts),
    profitThisYear: money(profitThisYear),
    profitEarlier: money(profitEarlier),
    suppliers: rounded(suppliers),
    customers: rounded(customers),
    payablesWithoutPartner: money(payablesWithoutPartner),
    receivablesWithoutPartner: money(receivablesWithoutPartner),
    off: money(off),
    purchases,
  };
}

export function readTrefinOpening(dir: string, day: string): TrefinOpening {
  const journal = parseCsv(fs.readFileSync(path.join(dir, JOURNAL), 'utf8'));
  const purchases = parseCsv(fs.readFileSync(path.join(dir, PURCHASES), 'utf8'));
  return trefinOpening(journal, purchases, day);
}

/**
 * The bills a supplier's balance is still made of: their newest invoices,
 * oldest of those partly paid, the rest explained by an older balance.
 * Most suppliers are paid oldest first, so the newest bills are the open ones.
 */
export function openBills(owed: number, purchases: TrefinPurchase[]): { bills: Array<TrefinPurchase & { open: number }>; rest: number } {
  const bills: Array<TrefinPurchase & { open: number }> = [];
  let left = money(owed);
  for (const purchase of purchases) {
    if (left <= 0) break;
    const open = money(Math.min(purchase.total, left));
    bills.push({ ...purchase, open });
    left = money(left - open);
  }
  return { bills, rest: left };
}
