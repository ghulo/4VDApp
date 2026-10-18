import fs from 'node:fs';
import path from 'node:path';
import { asSupplierCredit, type Boxes, type VatItem } from '../services/vat/vatReturn.js';
import { parseCsv } from './trefinImport.js';

/** TREFIN's documents in the export folder: the current database's sales and purchases, header and lines. */
const RAW = path.join('raw', 'MARKET_2025');
const FILES = { sales: 'tblShitje.csv', saleLines: 'tblShitje_Detaje.csv', bills: 'tblBlerje.csv', billLines: 'tblBlerje_Detaje.csv' } as const;
/** The cleaned partner lists the export writes next to the raw tables. */
const PARTNER_FILES = ['suppliers.csv', 'customers.csv'];

type Row = Record<string, string>;

/** TREFIN's VAT rate ids (tblNorma_TVSH). */
const RATES: Record<string, number | 'exempt'> = { '1': 'exempt', '2': 16, '3': 0, '4': 8, '5': 18 };
/** Sales to a named buyer: an invoice, and an export invoice (box 11). */
const INVOICE_TYPES = new Set(['FSM', 'FSS', 'FSA', 'EKS']);
const EXPORT_TYPE = 'EKS';
const TILL_TYPE = 'KUP';
/** Purchases of equipment, imports, and returns to a supplier. */
const EQUIPMENT_TYPES = new Set(['FBI', 'IMI']);
const IMPORT_TYPES = new Set(['IMM', 'IMS', 'IMI']);
const RETURN_TYPES = new Set(['KB', 'NDI']);

/** One of TREFIN's documents as 4VD's VAT return sees it, with TREFIN's partner code to match it by. */
export interface TrefinVatItem extends VatItem {
  code: string | null;
}

const num = (value: string | undefined) => (value === undefined || value.trim() === '' ? 0 : Number(value)) || 0;
const clean = (value: string | undefined) => (value ?? '').trim();
const money = (value: number) => Math.round(value * 100) / 100;

/** Sums are kept unrounded while lines are added, then rounded once per document, as TREFIN rounds its totals. */
class Sums {
  private readonly raw = new Map<number, number>();
  add(box: number, amount: number) {
    if (amount !== 0) this.raw.set(box, (this.raw.get(box) ?? 0) + amount);
  }
  boxes(): Boxes {
    const boxes: Boxes = {};
    for (const [box, amount] of this.raw) if (money(amount) !== 0) boxes[box] = money(amount);
    return boxes;
  }
}

/** A sale line's boxes: exempt → 9, 0% → 10, export → 11, 18%/16% → 12/13, 8% → 14/15; a returned line the customer-return boxes 53-56. */
function addSaleLine(sums: Sums, rate: number | 'exempt', net: number, vat: number, gross: number, exported: boolean) {
  const back = gross < 0;
  if (exported) return sums.add(11, gross);
  if (rate === 'exempt') return sums.add(9, gross);
  if (rate === 0 || vat === 0) return sums.add(10, gross);
  if (back) {
    sums.add(rate === 8 ? 55 : 53, -net);
    sums.add(rate === 8 ? 56 : 54, -vat);
  } else {
    sums.add(rate === 8 ? 14 : 12, net);
    sums.add(rate === 8 ? 15 : 13, vat);
  }
}

/** The rate a net and VAT pair was charged at: 8% or 18% (16% counts as 18%, as on the form), 0 when there is no VAT. */
const rateOf = (net: number, vat: number) => (vat === 0 || net === 0 ? 0 : Math.abs(vat / net - 0.08) < Math.abs(vat / net - 0.18) ? 8 : 18);

/**
 * A purchase split by rate. TREFIN's header keeps one local and one import
 * total; its lines carry the rate. The lines are used when they add up to the
 * header (goods), otherwise the header's own ratio tells the rate (services
 * have no lines).
 */
function splitByRate(net: number, vat: number, lines: Row[]): Array<{ rate: number; net: number; vat: number }> {
  if (net === 0 && vat === 0) return [];
  const byRate = new Map<number, { net: number; vat: number }>();
  for (const line of lines) {
    const id = RATES[clean(line.NR_TVSH)];
    const rate = id === undefined || id === 'exempt' ? 0 : id === 16 ? 18 : id;
    const entry = byRate.get(rate) ?? { net: 0, vat: 0 };
    entry.net += num(line.Vlera);
    entry.vat += num(line.TVSH);
    byRate.set(rate, entry);
  }
  const lineNet = [...byRate.values()].reduce((sum, entry) => sum + entry.net, 0);
  const lineVat = [...byRate.values()].reduce((sum, entry) => sum + entry.vat, 0);
  if (lines.length > 0 && Math.abs(lineNet - net) < 0.05 && Math.abs(lineVat - vat) < 0.05) return [...byRate].map(([rate, entry]) => ({ rate, ...entry }));
  return [{ rate: rateOf(net, vat), net, vat }];
}

function addPurchase(sums: Sums, parts: Array<{ rate: number; net: number; vat: number }>, imported: boolean, equipment: boolean) {
  for (const { rate, net, vat } of parts) {
    if (rate === 0 || vat === 0) {
      sums.add(equipment ? 32 : 31, net);
      continue;
    }
    const [base, tax] = imported ? (rate === 8 ? (equipment ? [41, 42] : [37, 38]) : equipment ? [39, 40] : [35, 36]) : rate === 8 ? (equipment ? [49, 50] : [45, 46]) : equipment ? [47, 48] : [43, 44];
    sums.add(base!, net);
    sums.add(tax!, vat);
  }
}

export interface TrefinVatRows {
  sales: Row[];
  saleLines: Row[];
  bills: Row[];
  billLines: Row[];
  partners: Row[];
}

/**
 * TREFIN's documents in a month ("2026-09") as VAT-return items: till
 * receipts one line per day, invoices and purchases one line each, with the
 * boxes they put figures in. Pure: the rows go in, the items come out.
 */
export function trefinVatMonth(rows: TrefinVatRows, month: string): TrefinVatItem[] {
  const inMonth = (row: Row) => clean(row.Data).slice(0, 7) === month;
  const partners = new Map(rows.partners.map((row) => [clean(row.code), { name: clean(row.name) || null, nui: /^[1-9]\d{6,}$/.test(clean(row.nui_unique_id)) ? clean(row.nui_unique_id) : null }]));
  const items: TrefinVatItem[] = [];

  const saleHeads = new Map(rows.sales.filter(inMonth).map((row) => [clean(row.NrRen), row]));
  const saleLines = new Map<string, Row[]>();
  for (const line of rows.saleLines) {
    if (!inMonth(line)) continue;
    const key = clean(line.NrRen);
    if (saleHeads.has(key)) saleLines.set(key, [...(saleLines.get(key) ?? []), line]);
  }
  const days = new Map<string, { sums: Sums; count: number }>();
  for (const [key, head] of saleHeads) {
    const type = clean(head.LlojDok);
    const lines = saleLines.get(key) ?? [];
    const exported = type === EXPORT_TYPE;
    const date = clean(head.Data).slice(0, 10);
    let sums: Sums;
    if (INVOICE_TYPES.has(type)) {
      sums = new Sums();
      const partner = partners.get(clean(head.NrKlient));
      const item: TrefinVatItem & { sums?: Sums } = { kind: 'invoice', ref: key, date, number: clean(head.NrFatura) || null, party: partner?.name ?? null, nui: partner?.nui ?? null, code: clean(head.NrKlient) || null, boxes: {}, count: lines.length };
      items.push(Object.assign(item, { sums }));
    } else if (type === TILL_TYPE) {
      const day = days.get(date) ?? { sums: new Sums(), count: 0 };
      days.set(date, day);
      day.count += lines.length;
      sums = day.sums;
    } else continue;
    if (lines.length === 0) {
      // A document with no lines: its header totals, which lump the rates together.
      addSaleLine(sums, 18, num(head.S_Vlera), num(head.S_TVSH), num(head.S_Vlera) + num(head.S_TVSH), false);
      addSaleLine(sums, 0, num(head.S_PaTVSH), 0, num(head.S_PaTVSH), exported);
      addSaleLine(sums, 'exempt', num(head.S_Ex), 0, num(head.S_Ex), false);
    }
    for (const line of lines) addSaleLine(sums, RATES[clean(line.NR_TVSH)] ?? 18, num(line.Vlera), num(line.TVSH), num(line.Totali), exported);
  }
  for (const item of items as Array<TrefinVatItem & { sums?: Sums }>) {
    if (item.sums) item.boxes = item.sums.boxes();
    delete item.sums;
  }
  for (const [date, day] of days) items.push({ kind: 'till_day', ref: date, date, number: null, party: null, nui: null, code: null, boxes: day.sums.boxes(), count: day.count });

  const billLines = new Map<string, Row[]>();
  for (const line of rows.billLines) billLines.set(clean(line.NrRen), [...(billLines.get(clean(line.NrRen)) ?? []), line]);
  for (const head of rows.bills.filter(inMonth)) {
    const type = clean(head.LlojDok);
    const key = clean(head.NrRen);
    const lines = billLines.get(key) ?? [];
    const sums = new Sums();
    const equipment = EQUIPMENT_TYPES.has(type);
    const localNet = num(head.B_Vend_Vlera) + num(head.B_Vend_I_Vlera);
    const localVat = num(head.B_Vend_TVSH) + num(head.B_Vend_I_TVSH);
    const importNet = num(head.B_Imp_Vlera) + num(head.B_Imp_I_Vlera);
    const importVat = num(head.B_Imp_TVSH) + num(head.B_Imo_I_TVSH);
    const importFree = num(head.B_Imp_PaTVSH) + num(head.B_Imp_I_PaTVSH);
    addPurchase(sums, splitByRate(Math.abs(localNet), Math.abs(localVat), lines), false, equipment || num(head.B_Vend_I_Vlera) !== 0);
    addPurchase(sums, splitByRate(Math.abs(importNet), Math.abs(importVat), IMPORT_TYPES.has(type) ? lines : []), true, equipment || num(head.B_Imp_I_Vlera) !== 0);
    if (importFree !== 0) sums.add(equipment ? 32 : 31, Math.abs(importFree));
    if (localNet === 0 && localVat === 0 && importNet === 0 && importVat === 0 && importFree === 0) {
      // No box columns filled: fall back to the document's own net and VAT.
      addPurchase(sums, splitByRate(Math.abs(num(head.Vlera)), Math.abs(num(head.TVSH)), lines), IMPORT_TYPES.has(type), equipment);
    }
    const credit = RETURN_TYPES.has(type) || num(head.Totali) < 0;
    const partner = partners.get(clean(head.NrKlient));
    items.push({
      kind: credit ? 'credit' : 'bill',
      ref: key,
      date: clean(head.Data).slice(0, 10),
      number: clean(head.NrFatura) || null,
      party: partner?.name ?? null,
      nui: partner?.nui ?? null,
      code: clean(head.NrKlient) || null,
      boxes: credit ? asSupplierCredit(sums.boxes()) : sums.boxes(),
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
}

/** Read a month from a TREFIN export folder. */
export function readTrefinVatMonth(dir: string, month: string): TrefinVatItem[] {
  const read = (file: string) => parseCsv(fs.readFileSync(path.join(dir, RAW, file), 'utf8'));
  const partners = PARTNER_FILES.flatMap((file) => (fs.existsSync(path.join(dir, file)) ? parseCsv(fs.readFileSync(path.join(dir, file), 'utf8')) : []));
  return trefinVatMonth({ sales: read(FILES.sales), saleLines: read(FILES.saleLines), bills: read(FILES.bills), billLines: read(FILES.billLines), partners }, month);
}
