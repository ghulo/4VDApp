import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { AssetCategory, AssetDisposal } from '../database/types.js';
import { DEFAULT_RATES } from '../services/assets/depreciation.js';

/** A bill line with no description gets its kind's word, as the books say it. */
const DEFAULT_NAMES: Record<AssetCategory, string> = { furniture: 'Mobilje', equipment: 'Pajisje', vehicle: 'Automjet', building: 'Ndërtesë', land: 'Tokë', intangible: 'Softuer ose licencë', other: 'Pasuri tjetër' };

export interface NewAsset {
  name: string;
  code: string | null;
  category: AssetCategory;
  boughtOn: string;
  inUseFrom: string;
  cost: number;
  residual: number;
  rate: number;
  openingDepreciated: number;
  billLineId: number | null;
  place: 'shop' | 'carwash';
  note: string | null;
  createdBy: number | null;
}

export interface AssetChanges {
  name?: string;
  code?: string | null;
  category?: AssetCategory;
  inUseFrom?: string;
  boughtOn?: string;
  cost?: number;
  residual?: number;
  rate?: number;
  openingDepreciated?: number;
  note?: string | null;
}

export interface AssetDisposalValues {
  disposedOn: string;
  disposal: AssetDisposal;
  saleNet: number | null;
  saleVatRate: number | null;
  saleVat: number | null;
  buyerName: string | null;
  buyerNui: string | null;
  customerId: number | null;
  paidPlaceId: number | null;
  creditBillId: number | null;
  note: string | null;
}

/** The register's rows, read with what they have worn so far. */
export const assetColumns = (db: DatabaseClient) =>
  db
    .selectFrom('fixed_assets as a')
    .leftJoin('bill_lines as bl', 'bl.id', 'a.bill_line_id')
    .leftJoin('supplier_bills as b', 'b.id', 'bl.bill_id')
    .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
    .leftJoin('customers as c', 'c.id', 'a.customer_id')
    .leftJoin('supplier_bills as cb', 'cb.id', 'a.credit_bill_id')
    .select([
      'a.id',
      'a.name',
      'a.code',
      'a.category',
      sql<string>`to_char(a.bought_on, 'YYYY-MM-DD')`.as('bought_on'),
      sql<string>`to_char(a.in_use_from, 'YYYY-MM-DD')`.as('in_use_from'),
      'a.cost',
      'a.residual',
      'a.rate',
      'a.opening_depreciated',
      'a.bill_line_id',
      'bl.bill_id',
      'b.number as bill_number',
      's.name as supplier_name',
      'a.place',
      'a.note',
      sql<string | null>`to_char(a.disposed_on, 'YYYY-MM-DD')`.as('disposed_on'),
      'a.disposal',
      'a.sale_net',
      'a.sale_vat_rate',
      'a.sale_vat',
      'a.buyer_name',
      'a.buyer_nui',
      'a.customer_id',
      'c.name as customer_name',
      'a.paid_place_id',
      'a.credit_bill_id',
      'cb.number as credit_bill_number',
      'a.disposal_note',
      'a.voided_at',
      sql<string>`(select coalesce(sum(l.amount), 0)::text from depreciation_lines l where l.asset_id = a.id)`.as('posted'),
      sql<string | null>`(select to_char(max(m.month), 'YYYY-MM-DD') from depreciation_lines l join depreciation_months m on m.id = l.month_id where l.asset_id = a.id)`.as('last_month'),
    ]);

export type AssetRow = Awaited<ReturnType<ReturnType<typeof assetColumns>['executeTakeFirstOrThrow']>>;

/**
 * Reads and writes of the fixed assets register. The bill service calls the
 * bill hooks inside its own transaction, so an equipment line and its asset
 * come and go together.
 */
export class AssetRepository {
  constructor(readonly db: DatabaseClient) {}

  async find(id: number): Promise<AssetRow | undefined> {
    return assetColumns(this.db).where('a.id', '=', id).executeTakeFirst();
  }

  async lock(id: number): Promise<void> {
    await sql`select id from fixed_assets where id = ${id} for update`.execute(this.db);
  }

  async create(asset: NewAsset): Promise<number> {
    const row = await this.db
      .insertInto('fixed_assets')
      .values({
        name: asset.name,
        code: asset.code,
        category: asset.category,
        bought_on: asset.boughtOn,
        in_use_from: asset.inUseFrom,
        cost: asset.cost,
        residual: asset.residual,
        rate: asset.rate,
        opening_depreciated: asset.openingDepreciated,
        bill_line_id: asset.billLineId,
        place: asset.place,
        note: asset.note,
        created_by: asset.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** Changes and asks for its months to be worked out again (only the ones not stored yet can change). */
  async update(id: number, changes: AssetChanges): Promise<void> {
    await this.db
      .updateTable('fixed_assets')
      .set({
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.code !== undefined && { code: changes.code }),
        ...(changes.category !== undefined && { category: changes.category }),
        ...(changes.inUseFrom !== undefined && { in_use_from: changes.inUseFrom }),
        ...(changes.boughtOn !== undefined && { bought_on: changes.boughtOn }),
        ...(changes.cost !== undefined && { cost: changes.cost }),
        ...(changes.residual !== undefined && { residual: changes.residual }),
        ...(changes.rate !== undefined && { rate: changes.rate }),
        ...(changes.openingDepreciated !== undefined && { opening_depreciated: changes.openingDepreciated }),
        ...(changes.note !== undefined && { note: changes.note }),
        filled_through: null,
      })
      .where('id', '=', id)
      .execute();
  }

  async dispose(id: number, values: AssetDisposalValues): Promise<void> {
    await this.db
      .updateTable('fixed_assets')
      .set({
        disposed_on: values.disposedOn,
        disposal: values.disposal,
        sale_net: values.saleNet,
        sale_vat_rate: values.saleVatRate,
        sale_vat: values.saleVat,
        buyer_name: values.buyerName,
        buyer_nui: values.buyerNui,
        customer_id: values.customerId,
        paid_place_id: values.paidPlaceId,
        credit_bill_id: values.creditBillId,
        disposal_note: values.note,
        filled_through: null,
      })
      .where('id', '=', id)
      .execute();
  }

  async undoDisposal(id: number): Promise<void> {
    await this.db
      .updateTable('fixed_assets')
      .set({
        disposed_on: null,
        disposal: null,
        sale_net: null,
        sale_vat_rate: null,
        sale_vat: null,
        buyer_name: null,
        buyer_nui: null,
        customer_id: null,
        paid_place_id: null,
        credit_bill_id: null,
        disposal_note: null,
        filled_through: null,
      })
      .where('id', '=', id)
      .execute();
  }

  async markVoided(id: number, actorId: number | null, at: Date): Promise<void> {
    await this.db.updateTable('fixed_assets').set({ voided_at: at, voided_by: actorId }).where('id', '=', id).execute();
  }

  /** Its stored months, oldest first. */
  async months(id: number): Promise<Array<{ month: string; amount: number }>> {
    const rows = await this.db
      .selectFrom('depreciation_lines as l')
      .innerJoin('depreciation_months as m', 'm.id', 'l.month_id')
      .select([sql<string>`to_char(m.month, 'YYYY-MM-DD')`.as('month'), 'l.amount'])
      .where('l.asset_id', '=', id)
      .orderBy('m.month')
      .execute();
    return rows.map((row) => ({ month: row.month, amount: Number(row.amount) }));
  }

  /** Drops its stored months from `from` on (all of them without `from`); their months post again. */
  async dropMonths(id: number, from: string | null = null): Promise<void> {
    let query = this.db.deleteFrom('depreciation_lines').where('asset_id', '=', id);
    if (from !== null) query = query.where('month_id', 'in', this.db.selectFrom('depreciation_months').select('id').where('month', '>=', from));
    await query.execute();
  }

  /** The bill's equipment lines become assets, at their cost on the books, at the default rate for their kind. */
  async addFromBill(billId: number, createdBy: number | null): Promise<number[]> {
    const lines = await this.db
      .selectFrom('bill_lines as l')
      .innerJoin('supplier_bills as b', 'b.id', 'l.bill_id')
      .select(['l.id', 'l.category', 'l.description', 'l.landed', sql<string>`to_char(b.issued_on, 'YYYY-MM-DD')`.as('issued_on'), 'b.place', 'b.kind'])
      .where('l.bill_id', '=', billId)
      .where('l.kind', '=', 'equipment')
      .execute();
    const ids: number[] = [];
    for (const line of lines) {
      if (line.kind !== 'bill' || Number(line.landed) <= 0) continue;
      const category = (line.category ?? 'other') as AssetCategory;
      ids.push(
        await this.create({
          name: line.description?.trim() || DEFAULT_NAMES[category],
          code: null,
          category,
          boughtOn: line.issued_on,
          inUseFrom: line.issued_on,
          cost: Number(line.landed),
          residual: 0,
          rate: DEFAULT_RATES[category],
          openingDepreciated: 0,
          billLineId: line.id,
          place: line.place === 'carwash' ? 'carwash' : 'shop',
          note: null,
          createdBy,
        }),
      );
    }
    return ids;
  }

  /** The assets that came from a bill's lines. */
  async ofBill(billId: number): Promise<AssetRow[]> {
    return assetColumns(this.db).where('bl.bill_id', '=', billId).where('a.voided_at', 'is', null).execute();
  }

  /** The assets a credit bill took back. */
  async returnedBy(creditBillId: number): Promise<AssetRow[]> {
    return assetColumns(this.db).where('a.credit_bill_id', '=', creditBillId).where('a.voided_at', 'is', null).execute();
  }
}
