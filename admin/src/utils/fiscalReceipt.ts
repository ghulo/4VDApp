import type { CounterSettings, VatRate } from '../services/types';

/*
 * The fiscal printer's jobs, written the way TREFIN writes them for Enternet's
 * F-Link (the Datecs printer's driver): one command per line, each starting
 * "<command>,1,______,_,__;" (1 is the printer; F-Link fills in the blanks
 * when it answers). The Windows app carries the text to F-Link's folder.
 */

const line = (command: string, ...fields: string[]) => `${command},1,______,_,__;${fields.join(';')}`;

const money = (amount: number) => amount.toFixed(2);

/** "2", "0.775": whole units stay whole, weights keep up to three decimals. */
const quantity = (amount: number) => String(Math.round(amount * 1000) / 1000);

/** The printer's article name: no field separators, at most 32 characters. */
export const printerName = (name: string) => name.replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32) || '-';

/**
 * The article number the printer files the product under. Products brought
 * over from the old program keep their numeric code, so the printer's own
 * records carry on; everything else gets 10000 + its id, clear of those.
 */
export function pluFor(product: { id: number; sku: string | null }): number {
  const sku = product.sku?.trim() ?? '';
  if (/^\d{1,6}$/.test(sku) && Number(sku) > 0 && Number(sku) < 10000) return Number(sku);
  return 10000 + product.id;
}

export interface ReceiptLine {
  product: { id: number; sku: string | null; name: string; vatRate: VatRate };
  /** The final price of one unit, after bulk, promotion and rabat. */
  unitPrice: number;
  quantity: number;
}

export type ReceiptPayment = { by: 'cash'; tendered: number | null } | { by: 'card' };

export class MissingTaxGroup extends Error {
  readonly rate: VatRate;
  constructor(rate: VatRate) {
    super(`No printer tax group for ${rate}% VAT`);
    this.rate = rate;
  }
}

/** The printer's tax group for a VAT rate, from the Counter settings. */
export function taxGroupFor(rate: VatRate, groups: CounterSettings['printer']['taxGroups']): number {
  const group = groups[String(rate) as keyof typeof groups];
  if (group === null || group === undefined) throw new MissingTaxGroup(rate);
  return group;
}

/**
 * One fiscal receipt: a line per product, the footer, then the payment.
 * Card sales print as cash, like the shop's receipts always have; the money
 * itself goes to the bank in 4VD.
 */
export function receiptJob(p: { lines: ReceiptLine[]; footer: string; taxGroups: CounterSettings['printer']['taxGroups']; payment: ReceiptPayment }): string {
  const sales = p.lines.map((item) =>
    line('S', printerName(item.product.name), money(item.unitPrice), quantity(item.quantity), '1', '1', String(taxGroupFor(item.product.vatRate, p.taxGroups)), '0', String(pluFor(item.product)), '0.00'),
  );
  const footer = printerName(p.footer.trim());
  const tendered = p.payment.by === 'cash' && p.payment.tendered !== null ? money(p.payment.tendered) : '';
  return [...sales, line('Q', '1', p.footer.trim() ? footer : ''), line('Q', '2', ''), line('T', '0', tendered), ''].join('\r\n');
}

/** The X report: the day so far, without closing it. */
export const xReportJob = () => [line('X', ''), ''].join('\r\n');

/** The Z report closes the fiscal day; it is shown on the customer display while it prints. */
export const zReportJob = (shopName: string) =>
  [line('E', 'Printo Z raportin', printerName(shopName)), line('Z', ''), line('E', printerName(shopName)), ''].join('\r\n');

/** After the Z: clear the printer's article list, so tomorrow's prices go in fresh. */
export const clearArticlesJob = () => [line('O', 'ALL'), ''].join('\r\n');

/** The customer display is two lines of 20 characters. */
export const DISPLAY_WIDTH = 20;

/** One display line: no field separators, spaces kept (they line figures up), cut to the width. */
const displayText = (text: string) => text.replace(/[;\r\n]+/g, ' ').slice(0, DISPLAY_WIDTH);

/** A word on the left and an amount on the right of one 20-character line. */
export function displayRow(left: string, right: string): string {
  const room = DISPLAY_WIDTH - right.length - 1;
  if (room < 1) return right.slice(-DISPLAY_WIDTH);
  return `${left.slice(0, room).padEnd(room)} ${right}`;
}

/** Two lines on the customer display: what was just scanned, the total, or the change to give back. */
export const displayJob = (top: string, bottom: string) => [line('E', displayText(top), displayText(bottom)), ''].join('\r\n');

/*
 * What the customer reads, in Albanian like the receipt: the product just
 * scanned and its price, the total while paying, then the change.
 */
export const displayFor = {
  item: (name: string, count: number, unitPrice: number, lineTotal: number): [string, string] => [
    printerName(name).slice(0, DISPLAY_WIDTH),
    count === 1 ? displayRow('', money(unitPrice)) : displayRow(`${quantity(count)} x ${money(unitPrice)}`, money(lineTotal)),
  ],
  total: (total: number): [string, string] => ['TOTALI', displayRow('EUR', money(total))],
  change: (change: number): [string, string] => ['KUSURI', displayRow('EUR', money(change))],
  thanks: (total: number): [string, string] => ['FALEMINDERIT!', displayRow('PAGUAR', money(total))],
};
