import { sql } from 'kysely';
import type { DatabaseClient } from '../../database/connection.js';
import { NotFoundError } from '../../errors/httpErrors.js';
import type { TrefinVatItem } from '../../scripts/trefinVat.js';
import { roundMoney } from '../../utils/money.js';
import { firstDay, type VatService } from './VatService.js';
import { type Boxes, CHARGED_ROWS, CLAIM_ROWS, type VatItem, type VatItemKind, vatResult } from './vatReturn.js';

const VAT_BOXES = new Set([...CHARGED_ROWS, ...CLAIM_ROWS].flatMap((row) => (row.vat ? [row.vat] : [])));
/** Differences up to this, in total and in VAT, are rounding: TREFIN rounds per line, 4VD per checkout. */
const ROUNDING = 0.1;

export type CompareStatus = 'same' | 'rounding' | 'differs';
/** Why a document differs: only one side has it, the other side counts it in another month, a different amount, or the same amount in other boxes (another rate). */
export type CompareReason = 'only_trefin' | 'only_4vd' | 'other_month' | 'amount' | 'rate';

export interface CompareSide {
  ref: string;
  number: string | null;
  party: string | null;
  base: number;
  vat: number;
  gross: number;
  /** Sale lines behind a till day. */
  count: number | null;
  boxes: Boxes;
}

export interface Explanation {
  note: string;
  by: string | null;
  at: string;
}

export interface CompareRow {
  /** Stable across reloads: TREFIN's document, or 4VD's when only 4VD has it, or the day. */
  key: string;
  kind: VatItemKind;
  date: string;
  status: CompareStatus;
  reason: CompareReason | null;
  /** Facts the dashboard words (e.g. the month 4VD counts a bill in). */
  facts: Record<string, string | number | null>;
  fourVd: CompareSide | null;
  trefin: CompareSide | null;
  explained: Explanation | null;
}

export interface CompareBox {
  box: number;
  fourVd: number;
  trefin: number;
}

export interface TrefinCompareDto {
  month: string;
  loaded: { at: string; by: string | null; source: string | null } | null;
  boxes: CompareBox[];
  /** VAT charged (30), VAT to claim back (67) and what's left to pay (72) on each side. */
  totals: { fourVd: { charged: number; claimable: number; toPay: number }; trefin: { charged: number; claimable: number; toPay: number } };
  rows: CompareRow[];
  counts: { same: number; rounding: number; differs: number; explained: number };
}

/** A 4VD document with the supplier's TREFIN code, to match bills by. */
export type FourVdItem = VatItem & { code?: string | null };
/** Where 4VD counts a bill TREFIN has this month, when it isn't in 4VD's month. */
export type ElsewhereLookup = (trefin: TrefinVatItem) => string | null;

const sumBoxes = (boxes: Boxes, keep: (box: number) => boolean) => roundMoney(Object.entries(boxes).reduce((sum, [box, amount]) => sum + (keep(Number(box)) ? (amount ?? 0) : 0), 0));

function side(item: VatItem): CompareSide {
  const gross = sumBoxes(item.boxes, () => true);
  const vat = sumBoxes(item.boxes, (box) => VAT_BOXES.has(box));
  return { ref: item.ref, number: item.number, party: item.party, base: roundMoney(gross - vat), vat, gross, count: item.kind === 'till_day' ? (item.count ?? 0) : null, boxes: item.boxes };
}

/** "INV-0042" and "inv 42" are the same bill number: case, spaces, dashes and leading zeros don't count. */
const sameNumber = (a: string | null, b: string | null) => {
  const norm = (value: string | null) => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(^|[^0-9])0+(?=[0-9])/g, '$1');
  return norm(a) !== '' && norm(a) === norm(b);
};
const samePartner = (a: FourVdItem, b: TrefinVatItem) =>
  Boolean((a.code && a.code === b.code) || (a.nui && a.nui === b.nui) || (a.party && b.party && a.party.trim().toLowerCase() === b.party.trim().toLowerCase()));
const sameGross = (a: VatItem, b: VatItem) => Math.abs(side(a).gross - side(b).gross) <= 0.02;
const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

function judge(fourVd: VatItem, trefin: VatItem): Pick<CompareRow, 'status' | 'reason' | 'facts'> {
  const a = side(fourVd);
  const b = side(trefin);
  const boxes = new Set([...Object.keys(a.boxes), ...Object.keys(b.boxes)].map(Number));
  if ([...boxes].every((box) => Math.abs((a.boxes[box] ?? 0) - (b.boxes[box] ?? 0)) < 0.005)) return { status: 'same', reason: null, facts: {} };
  const grossGap = roundMoney(a.gross - b.gross);
  const vatGap = roundMoney(a.vat - b.vat);
  const sameBoxes = Object.keys(a.boxes).sort().join() === Object.keys(b.boxes).sort().join();
  if (sameBoxes && Math.abs(grossGap) <= ROUNDING && Math.abs(vatGap) <= ROUNDING) return { status: 'rounding', reason: null, facts: { gross: grossGap, vat: vatGap } };
  if (Math.abs(grossGap) <= ROUNDING) return { status: 'differs', reason: 'rate', facts: { vat: vatGap } };
  return { status: 'differs', reason: 'amount', facts: { gross: grossGap, vat: vatGap, ...(a.count !== null && { fourVdLines: a.count, trefinLines: b.count }) } };
}

/**
 * Pair 4VD's documents for a month with TREFIN's and say how each pair
 * differs. Till days pair by day; invoices by number, else by day and amount;
 * bills by supplier and number, else by supplier and amount within a few days.
 * Pure, so it is tested without a database.
 */
export function compareItems(fourVdItems: FourVdItem[], trefinItems: TrefinVatItem[], elsewhere: ElsewhereLookup = () => null): Omit<CompareRow, 'explained'>[] {
  const rows: Omit<CompareRow, 'explained'>[] = [];
  const left = new Set(fourVdItems);
  const take = (match: (item: FourVdItem) => boolean) => {
    const found = [...left].find(match);
    if (found) left.delete(found);
    return found;
  };
  const isBill = (kind: VatItemKind) => kind === 'bill' || kind === 'credit';

  for (const trefin of trefinItems) {
    const fourVd =
      trefin.kind === 'till_day'
        ? take((item) => item.kind === 'till_day' && item.date === trefin.date)
        : trefin.kind === 'invoice'
          ? (take((item) => item.kind === 'invoice' && sameNumber(item.number, trefin.number)) ?? take((item) => item.kind === 'invoice' && item.date === trefin.date && sameGross(item, trefin)))
          : isBill(trefin.kind)
            ? (take((item) => item.kind === trefin.kind && samePartner(item, trefin) && sameNumber(item.number, trefin.number)) ??
              take((item) => item.kind === trefin.kind && samePartner(item, trefin) && sameGross(item, trefin) && dayGap(item.date, trefin.date) <= 5))
            : take((item) => item.kind === trefin.kind && item.date === trefin.date && sameGross(item, trefin));
    const key = trefin.kind === 'till_day' ? `day:${trefin.date}` : `t:${trefin.ref}`;
    if (fourVd) {
      rows.push({ key, kind: trefin.kind, date: trefin.date, ...judge(fourVd, trefin), fourVd: side(fourVd), trefin: side(trefin) });
      continue;
    }
    const month = isBill(trefin.kind) ? elsewhere(trefin) : null;
    rows.push({ key, kind: trefin.kind, date: trefin.date, status: 'differs', reason: month ? 'other_month' : 'only_trefin', facts: month ? { month } : {}, fourVd: null, trefin: side(trefin) });
  }
  for (const fourVd of left) {
    rows.push({ key: fourVd.kind === 'till_day' ? `day:${fourVd.date}` : `v:${fourVd.kind}:${fourVd.ref}`, kind: fourVd.kind, date: fourVd.date, status: 'differs', reason: 'only_4vd', facts: {}, fourVd: side(fourVd), trefin: null });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key, undefined, { numeric: true }));
}

const totals = (boxes: Record<number, number>) => ({ charged: boxes[30] ?? 0, claimable: boxes[67] ?? 0, toPay: boxes[72] ?? 0 });

/**
 * One VAT month run next to TREFIN: TREFIN's documents for the month are
 * loaded from a fresh export (`npm run compare:trefin`), set beside 4VD's,
 * and every difference is explained by a person before the books are trusted.
 */
export class TrefinCompareService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly vat: VatService,
  ) {}

  /** Keep TREFIN's documents for the month; explanations already given stay. */
  async load(month: string, items: TrefinVatItem[], source: string | null, actorId: number | null): Promise<void> {
    await this.db
      .insertInto('trefin_months')
      .values({ month: firstDay(month), items: JSON.stringify(items), source, loaded_by: actorId })
      .onConflict((oc) => oc.column('month').doUpdateSet({ items: JSON.stringify(items), source, loaded_by: actorId, loaded_at: new Date() }))
      .execute();
  }

  /** Months TREFIN has been loaded for, newest first. */
  async months(): Promise<string[]> {
    const rows = await this.db.selectFrom('trefin_months').select(sql<string>`to_char(month, 'YYYY-MM')`.as('month')).orderBy('trefin_months.month', 'desc').execute();
    return rows.map((row) => row.month);
  }

  async view(month: string): Promise<TrefinCompareDto> {
    const record = await this.db
      .selectFrom('trefin_months as t')
      .leftJoin('users as u', 'u.id', 't.loaded_by')
      .select(['t.items', 't.source', 't.loaded_at', 't.explained', 'u.name'])
      .where('t.month', '=', firstDay(month))
      .executeTakeFirst();
    const dto = await this.vat.month(month);
    const fourVdBoxes = dto.boxes;
    if (!record) {
      return { month, loaded: null, boxes: [], totals: { fourVd: totals(fourVdBoxes), trefin: { charged: 0, claimable: 0, toPay: 0 } }, rows: [], counts: { same: 0, rounding: 0, differs: 0, explained: 0 } };
    }
    const trefinItems = record.items as TrefinVatItem[];
    // Box 68 and the refund are the same on both sides, so only the documents make a difference.
    const trefinBoxes = vatResult(trefinItems, fourVdBoxes[68] ?? 0, fourVdBoxes[70] ?? 0).boxes;
    const fourVdItems = await this.withCodes(dto.items);
    const elsewhere = await this.elsewhere(month, trefinItems);
    const explained = (record.explained ?? {}) as Record<string, Explanation>;
    const rows = compareItems(fourVdItems, trefinItems, (item) => elsewhere.get(item.ref) ?? null).map((row) => ({ ...row, explained: row.status === 'differs' ? (explained[row.key] ?? null) : null }));
    const boxes: CompareBox[] = [];
    for (let box = 9; box <= 72; box += 1) {
      if (box === 68 || box === 70) continue;
      const fourVd = fourVdBoxes[box] ?? 0;
      const trefin = trefinBoxes[box] ?? 0;
      if (fourVd !== 0 || trefin !== 0) boxes.push({ box, fourVd, trefin });
    }
    return {
      month,
      loaded: { at: record.loaded_at.toISOString(), by: record.name ?? null, source: record.source },
      boxes,
      totals: { fourVd: totals(fourVdBoxes), trefin: totals(trefinBoxes) },
      rows,
      counts: {
        same: rows.filter((row) => row.status === 'same').length,
        rounding: rows.filter((row) => row.status === 'rounding').length,
        differs: rows.filter((row) => row.status === 'differs').length,
        explained: rows.filter((row) => row.explained !== null).length,
      },
    };
  }

  /** Say why a difference is fine (or take the explanation back with null). */
  async explain(month: string, key: string, note: string | null, actor: { id: number; name: string }): Promise<TrefinCompareDto> {
    const record = await this.db.selectFrom('trefin_months').select('explained').where('month', '=', firstDay(month)).executeTakeFirst();
    if (!record) throw new NotFoundError('TREFIN has not been loaded for this month');
    const explained = { ...((record.explained ?? {}) as Record<string, Explanation>) };
    if (note === null) delete explained[key];
    else explained[key] = { note, by: actor.name, at: new Date().toISOString() };
    await this.db.updateTable('trefin_months').set({ explained: JSON.stringify(explained) }).where('month', '=', firstDay(month)).execute();
    return this.view(month);
  }

  /** 4VD's bills with their supplier's TREFIN code. */
  private async withCodes(items: VatItem[]): Promise<FourVdItem[]> {
    const billIds = items.filter((item) => item.kind === 'bill' || item.kind === 'credit').map((item) => Number(item.ref));
    if (billIds.length === 0) return items;
    const rows = await this.db.selectFrom('supplier_bills as b').leftJoin('suppliers as s', 's.id', 'b.supplier_id').select(['b.id', 's.external_code']).where('b.id', 'in', billIds).execute();
    const codes = new Map(rows.map((row) => [String(row.id), row.external_code]));
    return items.map((item) => (item.kind === 'bill' || item.kind === 'credit' ? { ...item, code: codes.get(item.ref) ?? null } : item));
  }

  /** For TREFIN's bills, the month 4VD counts the same bill in when it is another month. */
  private async elsewhere(month: string, items: TrefinVatItem[]): Promise<Map<string, string>> {
    const bills = items.filter((item) => (item.kind === 'bill' || item.kind === 'credit') && item.number);
    if (bills.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('supplier_bills as b')
      .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
      .select(['b.number', 's.external_code', 's.nui', 's.name', sql<string>`to_char(coalesce(b.vat_month, b.issued_on), 'YYYY-MM')`.as('counted')])
      .where('b.voided_at', 'is', null)
      .where('b.brought_over', '=', false)
      .where('b.trefin_ref', 'is', null)
      .execute();
    const found = new Map<string, string>();
    for (const bill of bills) {
      const match = rows.find(
        (row) => sameNumber(row.number, bill.number) && ((row.external_code && row.external_code === bill.code) || (row.nui && row.nui === bill.nui) || (row.name && bill.party && row.name.toLowerCase() === bill.party.toLowerCase())),
      );
      if (!match) continue;
      if (match.counted !== month) found.set(bill.ref, match.counted);
    }
    return found;
  }
}
