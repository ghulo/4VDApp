import { sql } from 'kysely';
import type { CountLineStatus, CountStatus } from '../constants/approvals.js';
import type { DatabaseClient } from '../database/connection.js';

export interface StockCountRecord {
  id: number;
  category_id: number | null;
  category_name: string | null;
  status: CountStatus;
  started_by: number | null;
  started_by_name: string | null;
  started_at: Date;
  submitted_by: number | null;
  submitted_at: Date | null;
  closed_at: Date | null;
}

/** One product in a count's scope, with its line if it has been counted. */
export interface CountProductRow {
  product_id: number;
  product_name: string;
  sku: string | null;
  category_name: string;
  counted_quantity: number | null;
  expected_quantity: number | null;
  unit_cost: string | null;
  status: CountLineStatus | null;
  decision_note: string | null;
}

export interface CountLineRecord {
  count_id: number;
  product_id: number;
  product_name: string;
  counted_quantity: number;
  expected_quantity: number;
  status: CountLineStatus | null;
}

/** Any fixed number works; it only has to be the same for every count start. */
const COUNT_START_LOCK = 4021;

export class StockCountRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery() {
    return this.db
      .selectFrom('stock_counts as sc')
      .leftJoin('categories as c', 'c.id', 'sc.category_id')
      .leftJoin('users as u', 'u.id', 'sc.started_by')
      .select([
        'sc.id',
        'sc.category_id',
        'c.name as category_name',
        'sc.status',
        'sc.started_by',
        'u.name as started_by_name',
        'sc.started_at',
        'sc.submitted_by',
        'sc.submitted_at',
        'sc.closed_at',
      ]);
  }

  /** Serialise count starts so two overlapping counts can't both begin. Must run in a transaction. */
  async lockStarts(): Promise<void> {
    await sql`select pg_advisory_xact_lock(${COUNT_START_LOCK})`.execute(this.db);
  }

  /** Open or submitted counts whose scope overlaps: the whole shop overlaps everything. */
  async findOverlapping(categoryId: number | null): Promise<StockCountRecord | undefined> {
    let query = this.baseQuery().where('sc.status', 'in', ['open', 'submitted']);
    if (categoryId !== null) {
      query = query.where((eb) => eb.or([eb('sc.category_id', 'is', null), eb('sc.category_id', '=', categoryId)]));
    }
    return query.executeTakeFirst();
  }

  async create(categoryId: number | null, startedBy: number): Promise<number> {
    const row = await this.db
      .insertInto('stock_counts')
      .values({ category_id: categoryId, status: 'open', started_by: startedBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  findById(id: number): Promise<StockCountRecord | undefined> {
    return this.baseQuery().where('sc.id', '=', id).executeTakeFirst();
  }

  async lock(id: number): Promise<StockCountRecord | undefined> {
    await this.db.selectFrom('stock_counts').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
    return this.findById(id);
  }

  /** Open and submitted counts first, then the most recent closed or cancelled ones. */
  async findRecent(closedLimit: number): Promise<StockCountRecord[]> {
    const active = await this.baseQuery().where('sc.status', 'in', ['open', 'submitted']).orderBy('sc.started_at', 'desc').execute();
    const finished = await this.baseQuery()
      .where('sc.status', 'in', ['closed', 'cancelled'])
      .orderBy('sc.started_at', 'desc')
      .limit(closedLimit)
      .execute();
    return [...active, ...finished];
  }

  /**
   * Every product the count covers, alphabetically. Active products in scope,
   * plus any product already counted (in case it was hidden since).
   */
  async products(countId: number, categoryId: number | null): Promise<CountProductRow[]> {
    const scope = categoryId === null ? sql`true` : sql`p.category_id = ${categoryId}`;
    const result = await sql<CountProductRow>`
      select p.id as product_id, p.name as product_name, p.sku, c.name as category_name,
             l.counted_quantity, l.expected_quantity, l.unit_cost, l.status, l.decision_note
      from products p
      join categories c on c.id = p.category_id
      left join stock_count_lines l on l.product_id = p.id and l.count_id = ${countId}
      where (p.deleted_at is null and p.is_active and ${scope}) or l.id is not null
      order by p.name, p.id
    `.execute(this.db);
    return result.rows;
  }

  async isInScope(productId: number, categoryId: number | null): Promise<boolean> {
    let query = this.db
      .selectFrom('products')
      .select('id')
      .where('id', '=', productId)
      .where('deleted_at', 'is', null)
      .where('is_active', '=', true);
    if (categoryId !== null) query = query.where('category_id', '=', categoryId);
    return (await query.executeTakeFirst()) !== undefined;
  }

  /** Counting again replaces the line and takes a fresh expected number. */
  async upsertLine(line: {
    countId: number;
    productId: number;
    counted: number;
    expected: number;
    unitCost: number | null;
    countedBy: number;
  }): Promise<void> {
    const values = {
      counted_quantity: line.counted,
      expected_quantity: line.expected,
      unit_cost: line.unitCost,
      counted_by: line.countedBy,
      counted_at: new Date(),
    };
    await this.db
      .insertInto('stock_count_lines')
      .values({ count_id: line.countId, product_id: line.productId, ...values })
      .onConflict((oc) => oc.columns(['count_id', 'product_id']).doUpdateSet(values))
      .execute();
  }

  async lines(countId: number, status?: CountLineStatus): Promise<CountLineRecord[]> {
    let query = this.db
      .selectFrom('stock_count_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['l.count_id', 'l.product_id', 'p.name as product_name', 'l.counted_quantity', 'l.expected_quantity', 'l.status'])
      .where('l.count_id', '=', countId);
    if (status) query = query.where('l.status', '=', status);
    return query.orderBy('p.name').execute();
  }

  async lockLine(countId: number, productId: number): Promise<CountLineRecord | undefined> {
    await this.db
      .selectFrom('stock_count_lines')
      .select('id')
      .where('count_id', '=', countId)
      .where('product_id', '=', productId)
      .forUpdate()
      .executeTakeFirst();
    const lines = await this.lines(countId);
    return lines.find((line) => line.product_id === productId);
  }

  /** On submit: matching lines become `match`, the rest `pending`. Returns how many are pending. */
  async markSubmitted(countId: number, submittedBy: number): Promise<number> {
    await this.db
      .updateTable('stock_count_lines')
      .set({ status: sql`case when counted_quantity = expected_quantity then 'match' else 'pending' end` })
      .where('count_id', '=', countId)
      .execute();
    await this.db
      .updateTable('stock_counts')
      .set({ status: 'submitted', submitted_by: submittedBy, submitted_at: new Date() })
      .where('id', '=', countId)
      .execute();
    return (await this.lines(countId, 'pending')).length;
  }

  async decideLine(
    countId: number,
    productId: number,
    decision: { status: 'approved' | 'rejected'; decidedBy: number; note: string | null },
  ): Promise<void> {
    await this.db
      .updateTable('stock_count_lines')
      .set({ status: decision.status, decided_by: decision.decidedBy, decided_at: new Date(), decision_note: decision.note })
      .where('count_id', '=', countId)
      .where('product_id', '=', productId)
      .execute();
  }

  async setStatus(countId: number, status: CountStatus): Promise<void> {
    const closing = status === 'closed' || status === 'cancelled';
    await this.db
      .updateTable('stock_counts')
      .set({ status, ...(closing && { closed_at: new Date() }) })
      .where('id', '=', countId)
      .execute();
  }
}
