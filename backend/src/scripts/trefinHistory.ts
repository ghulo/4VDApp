import fs from 'node:fs';
import path from 'node:path';

/**
 * TREFIN's history beyond today's list: what its three databases kept about
 * partners, purchases (deleted ones too) and the products as each database
 * named them. Read from the export's `raw\<database>\` tables and
 * `purchases.csv`; trefinImport brings it in as look-only history.
 */

type Row = Record<string, string>;

/** Newest first: when two databases disagree, the newer one wins. */
export const TREFIN_DATABASES = ['MARKET_2025', 'MARKET_2022', 'MARKET_2022_FINAL_2023_05_26'] as const;
export type TrefinDatabase = (typeof TREFIN_DATABASES)[number];
/** How a person would name each database. */
export const DATABASE_LABELS: Record<string, string> = {
  MARKET_2025: 'its books from Mar 2025 on',
  MARKET_2022: 'its books from May 2023 to Mar 2025',
  MARKET_2022_FINAL_2023_05_26: 'its 2023 backup (Apr 2022 to May 2023)',
};

/** TREFIN's purchase document types, in plain words. KB gives back; the rest are bills. */
export const PURCHASE_TYPES: Record<string, string> = {
  FBM: 'goods bill',
  FBS: 'other purchase bill',
  FBI: 'import bill',
  IMM: 'equipment bill',
  KB: 'return to the supplier',
};

export interface TrefinHistory {
  /** tblKlientet of each database. */
  partners: Record<string, Row[]>;
  /** tblArtikujt of each database: code → barcode and name as that database had them. */
  products: Record<string, Map<string, { barcode: string; name: string }>>;
  /** tblBlerje of each database (live purchase headers). */
  bills: Record<string, Row[]>;
  /** purchases.csv: the live purchase lines of all databases, already without duplicates. */
  billLines: Row[];
  /** tblBlerje_Delete and _Detaje_Delete of each database. */
  deletedBills: Record<string, Row[]>;
  deletedBillLines: Record<string, Row[]>;
  /** tblDeleteDoc of each database: who deleted what, and when. */
  deleteLog: Record<string, Row[]>;
}

/** A small RFC 4180 reader: quoted fields, doubled quotes, commas and line breaks inside quotes, a BOM. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = (rows.shift() ?? []).map((name) => name.replace(/^﻿/, ''));
  return rows.filter((cells) => cells.length > 1).map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}

/** The raw tables, or undefined when the export has no `raw` folder (an older export). */
export function readTrefinHistory(dir: string): TrefinHistory | undefined {
  const raw = path.join(dir, 'raw');
  if (!fs.existsSync(raw)) return undefined;
  const table = (db: string, name: string): Row[] => {
    const file = path.join(raw, db, `${name}.csv`);
    return fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [];
  };
  const each = (name: string) => Object.fromEntries(TREFIN_DATABASES.map((db) => [db, table(db, name)]));
  return {
    partners: each('tblKlientet'),
    products: Object.fromEntries(
      TREFIN_DATABASES.map((db) => [db, new Map(table(db, 'tblArtikujt').map((row) => [clean(row.NrArt), { barcode: clean(row.Barcode), name: clean(row.EmerArt) }]))]),
    ),
    bills: each('tblBlerje'),
    billLines: parseCsv(fs.readFileSync(path.join(dir, 'purchases.csv'), 'utf8')),
    deletedBills: each('tblBlerje_Delete'),
    deletedBillLines: each('tblBlerje_Detaje_Delete'),
    deleteLog: each('tblDeleteDoc'),
  };
}

export const clean = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
export const num = (value: string | undefined) => (value === undefined || value.trim() === '' ? 0 : Number(value));
export const money = (value: number) => Math.round(value * 100) / 100;
/** TREFIN fills empty fields with 0, 1, - or ///. */
export const filled = (value: string | undefined) => {
  const text = clean(value);
  return text === '' || /^[0/\\.\-\s]+$/.test(text) || text === '1' ? null : text;
};
export const nui = (value: string | undefined) => {
  const text = filled(value);
  return text && /^\d{9}$/.test(text) ? text : null;
};
/** Names compared the way a person would: case, spaces and dots don't count. */
export const sameName = (a: string, b: string) => normalName(a) === normalName(b);
export const normalName = (name: string) => name.toLowerCase().replace(/[\s.]+/g, ' ').trim();

/** One supplier or customer, merged from every database and from the clean files. */
export interface TrefinPartner {
  code: string;
  name: string;
  tradeName: string | null;
  nui: string | null;
  /** NUI-like text that isn't 9 digits, kept in the note. */
  oddNui: string | null;
  businessNo: string | null;
  fiscalNo: string | null;
  vatNo: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  iban: string | null;
  contactPerson: string | null;
  creditLimit: number | null;
  discountPercent: number | null;
  isSupplier: boolean;
  isCustomer: boolean;
  /** From the clean files (today's ledger): what we owed them, what they owed us. */
  weOwe: number;
  theyOwe: number;
  /** "<database>/<code>" of every record merged into this one. */
  keys: string[];
}

/** TREFIN's stand-ins for "any supplier", "any customer" and the cash desk. */
export const GENERIC_PARTNERS = new Set(['700000', '700001', '699999']);

const PLACE_HOLDERS = new Set(['pn', 'p.n.', 'pn.', '-']);
const place = (value: string | undefined) => {
  const text = filled(value);
  return text && !PLACE_HOLDERS.has(text.toLowerCase()) ? text : null;
};

/** A TREFIN partner record from a raw table, in the shape the clean files use. */
function fromRaw(row: Row): Omit<TrefinPartner, 'keys' | 'weOwe' | 'theyOwe'> {
  return {
    code: clean(row.NrKlient),
    name: clean(row.EmerKlient),
    tradeName: filled(row.EmerTregtar),
    nui: nui(row.NRU),
    oddNui: filled(row.NRU) && !nui(row.NRU) ? clean(row.NRU) : null,
    businessNo: filled(row.NRB),
    fiscalNo: filled(row.NRF),
    vatNo: filled(row.NRTVSH),
    phone: filled(row.Tel),
    mobile: filled(row.Mobil),
    email: filled(row.eMail),
    address: place(row.Adresa),
    city: place(row.Qyteti),
    iban: filled(row.LlogariaBankare),
    contactPerson: filled(row.Kontakt),
    creditLimit: num(row.Limit) > 0 ? money(num(row.Limit)) : null,
    discountPercent: num(row.Rabati) > 0 && num(row.Rabati) <= 100 ? num(row.Rabati) : null,
    isSupplier: row.Furnitor === 'True',
    isCustomer: row.Klient === 'True',
  };
}

/** A partner from the clean files (suppliers.csv, customers.csv). */
function fromClean(row: Row, kind: 'supplier' | 'customer'): Omit<TrefinPartner, 'keys'> {
  return {
    code: clean(row.code),
    name: clean(row.name),
    tradeName: filled(row.trade_name),
    nui: nui(row.nui_unique_id),
    oddNui: filled(row.nui_unique_id) && !nui(row.nui_unique_id) ? clean(row.nui_unique_id) : null,
    businessNo: filled(row.nrb_business_no),
    fiscalNo: filled(row.fiscal_no),
    vatNo: filled(row.vat_no),
    phone: filled(row.phone),
    mobile: filled(row.mobile),
    email: filled(row.email),
    address: place(row.address),
    city: place(row.city),
    iban: filled(row.bank_account_iban),
    contactPerson: filled(row.contact_person),
    creditLimit: num(row.credit_limit) > 0 ? money(num(row.credit_limit)) : null,
    discountPercent: num(row.discount_percent) > 0 && num(row.discount_percent) <= 100 ? num(row.discount_percent) : null,
    isSupplier: kind === 'supplier',
    isCustomer: kind === 'customer',
    weOwe: kind === 'supplier' ? num(row.balance_we_owe_them) : 0,
    theyOwe: kind === 'customer' ? num(row.balance_they_owe_us) : 0,
  };
}

/**
 * Every supplier and customer once. The clean files (today's database) come
 * first; each older database's record joins the one with the same code when
 * it is the same business (same NUI or name), else the one with its NUI, else
 * it is a partner of its own. Banks and TREFIN's stand-ins are left out.
 * `byKey` finds the merged partner for "<database>/<code>".
 */
export function mergePartners(files: { suppliers: Row[]; customers: Row[] }, history: TrefinHistory | undefined): { partners: TrefinPartner[]; byKey: Map<string, TrefinPartner> } {
  const partners: TrefinPartner[] = [];
  const byKey = new Map<string, TrefinPartner>();
  const fill = (into: TrefinPartner, from: Omit<TrefinPartner, 'keys' | 'weOwe' | 'theyOwe'>) => {
    for (const key of Object.keys(from) as Array<keyof typeof from>) {
      if (key === 'isSupplier' || key === 'isCustomer') into[key] = into[key] || from[key];
      else if (into[key] === null && from[key] !== null) (into as unknown as Record<string, unknown>)[key] = from[key];
    }
  };
  const add = (record: Omit<TrefinPartner, 'keys' | 'weOwe' | 'theyOwe'> & { weOwe?: number; theyOwe?: number }, key: string) => {
    if (!record.code || !record.name || GENERIC_PARTNERS.has(record.code)) return;
    // The clean files were built from today's database, so its record with the same code is always the same partner.
    const fromToday = (p: TrefinPartner) => key.startsWith('MARKET_2025/') && p.keys.some((k) => k.startsWith('clean/'));
    const sameCode = partners.find((p) => p.code === record.code && (fromToday(p) || (p.nui !== null && p.nui === record.nui) || sameName(p.name, record.name)));
    // Two codes for one NUI in the same database stay two partners: TREFIN kept a balance on each code (the
    // opening balances match by code), so the duplicate is for a person to merge.
    const database = (k: string) => (k.startsWith('clean/') ? 'MARKET_2025' : k.slice(0, k.indexOf('/')));
    const sameNui = record.nui ? partners.find((p) => p.nui === record.nui && !p.keys.some((k) => database(k) === database(key))) : undefined;
    const into = sameCode ?? sameNui;
    if (into) {
      fill(into, record);
      into.weOwe += record.weOwe ?? 0;
      into.theyOwe += record.theyOwe ?? 0;
      into.keys.push(key);
      byKey.set(key, into);
      return;
    }
    const created: TrefinPartner = { ...record, weOwe: record.weOwe ?? 0, theyOwe: record.theyOwe ?? 0, keys: [key] };
    partners.push(created);
    byKey.set(key, created);
  };
  for (const row of files.suppliers) add(fromClean(row, 'supplier'), `clean/${clean(row.code)}`);
  for (const row of files.customers) add(fromClean(row, 'customer'), `clean/${clean(row.code)}`);
  if (history) {
    for (const db of TREFIN_DATABASES) {
      for (const row of history.partners[db] ?? []) {
        if (row.Bank === 'True' && row.Furnitor !== 'True' && row.Klient !== 'True') continue;
        const record = fromRaw(row);
        if (!record.isSupplier && !record.isCustomer) continue;
        add(record, `${db}/${record.code}`);
      }
    }
  }
  // Today's database used the same codes as the clean files.
  for (const partner of partners) {
    for (const key of partner.keys.filter((k) => k.startsWith('clean/'))) {
      const code = key.slice('clean/'.length);
      if (!byKey.has(`MARKET_2025/${code}`)) byKey.set(`MARKET_2025/${code}`, partner);
    }
  }
  return { partners, byKey };
}

/** One TREFIN purchase document, ready to become a look-only bill. */
export interface TrefinBill {
  ref: string;
  db: string;
  type: string;
  number: string | null;
  issuedOn: string;
  supplierKey: string;
  /** TREFIN's stand-in supplier, or a code it no longer knew: shown in the note. */
  supplierName: string | null;
  amount: number;
  vat: number | null;
  /** TREFIN's own "paid" mark and amount. */
  paidInTrefin: number | null;
  deleted: { at: string; by: string | null } | null;
  lines: Array<{ code: string; barcode: string; name: string; unit: string; quantity: number; unitNet: number; net: number; vat: number; vatRate: number }>;
}

const day = (value: string | undefined) => clean(value).slice(0, 10);

/**
 * TREFIN's purchases, the deleted ones too. The live ones are those in
 * purchases.csv (which already left out the copies an older database kept of
 * a newer one's documents); deleted ones that appear in more than one
 * database are taken once.
 */
export function trefinBills(history: TrefinHistory): TrefinBill[] {
  const lines = new Map<string, Row[]>();
  for (const line of history.billLines) {
    const ref = `${clean(line.source_db)}/${clean(line.doc_id)}`;
    lines.set(ref, [...(lines.get(ref) ?? []), line]);
  }
  const headers = new Map<string, Row>();
  for (const db of TREFIN_DATABASES) for (const row of history.bills[db] ?? []) headers.set(`${db}/${clean(row.NrRen)}`, row);

  const bills: TrefinBill[] = [];
  for (const [ref, rows] of lines) {
    const db = ref.slice(0, ref.indexOf('/'));
    const first = rows[0]!;
    const header = headers.get(ref);
    bills.push({
      ref,
      db,
      type: clean(first.doc_type),
      number: filled(first.document_number),
      issuedOn: day(first.purchase_date),
      supplierKey: `${db}/${clean(first.supplier_code)}`,
      supplierName: clean(first.supplier) || null,
      amount: money(header ? num(header.Totali) : rows.reduce((sum, row) => sum + num(row.line_total), 0)),
      vat: header ? money(num(header.TVSH)) : null,
      paidInTrefin: header && header.PagesaPoJo === 'True' ? money(num(header.PagesaShuma)) : null,
      deleted: null,
      lines: rows.map((row) => ({
        code: clean(row.product_code),
        barcode: clean(row.barcode),
        name: clean(row.product_name),
        unit: clean(row.unit),
        quantity: num(row.quantity),
        unitNet: num(row.unit_cost_excl_vat),
        net: num(row.net_amount),
        vat: num(row.vat_amount),
        vatRate: Math.round(num(row.vat_rate_percent)),
      })),
    });
  }

  const seen = new Set<string>();
  for (const db of TREFIN_DATABASES) {
    const log = history.deleteLog[db] ?? [];
    for (const row of history.deletedBills[db] ?? []) {
      const twin = `${clean(row.NrFatura)}|${day(row.Data)}|${clean(row.NrKlient)}|${money(num(row.Totali))}`;
      if (seen.has(twin)) continue;
      seen.add(twin);
      const entry = log.find((item) => clean(item.NrRen) === clean(row.NrRen) && clean(item.LlojDok) === clean(row.LlojDok));
      const products = history.products[db];
      bills.push({
        ref: `${db}/${clean(row.NrRen)}`,
        db,
        type: clean(row.LlojDok),
        number: filled(row.NrFatura),
        issuedOn: day(row.Data),
        supplierKey: `${db}/${clean(row.NrKlient)}`,
        supplierName: entry ? clean(entry.EmerKlient) : null,
        amount: money(num(row.Totali)),
        vat: money(num(row.TVSH)),
        paidInTrefin: row.PagesaPoJo === 'True' ? money(num(row.PagesaShuma)) : null,
        deleted: { at: clean(entry?.DataDelete) || `${day(row.Data)} 12:00:00`, by: entry ? clean(entry.EmerUser) || null : null },
        lines: (history.deletedBillLines[db] ?? [])
          .filter((line) => clean(line.NrRen) === clean(row.NrRen))
          .map((line) => {
            const net = num(line.Vlera);
            const vat = num(line.TVSH);
            const known = products?.get(clean(line.NrArt));
            return {
              code: clean(line.NrArt),
              barcode: known?.barcode ?? '',
              name: known?.name ?? '',
              unit: '',
              quantity: num(line.Sasia),
              unitNet: num(line.Cmimi),
              net,
              vat,
              vatRate: net > 0 ? Math.round((vat / net) * 100) : 0,
            };
          }),
      });
    }
  }
  return bills.sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.ref.localeCompare(b.ref));
}
