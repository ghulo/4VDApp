import type { DatabaseClient } from '../database/connection.js';
import type { ProductRequestStatus } from '../database/types.js';

export interface ProductRequestRecord {
  id: number;
  status: ProductRequestStatus;
  name: string;
  category_id: number | null;
  category_name: string | null;
  price: string;
  vat_rate: number;
  barcode: string | null;
  origin_country: string | null;
  photo_media_id: string | null;
  stock: number;
  note: string | null;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  product_id: number | null;
}

export interface NewProductRequest {
  name: string;
  categoryId: number | null;
  price: number;
  vatRate: number;
  barcode: string | null;
  originCountry: string | null;
  photoMediaId: string | null;
  stock: number;
  note: string | null;
  requestedBy: number;
}

/** Products people at the counter asked to add, until someone decides. */
export class ProductRequestRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(input: NewProductRequest): Promise<number> {
    const row = await this.db
      .insertInto('product_requests')
      .values({
        name: input.name,
        category_id: input.categoryId,
        price: input.price,
        vat_rate: input.vatRate,
        barcode: input.barcode,
        origin_country: input.originCountry,
        photo_media_id: input.photoMediaId,
        stock: input.stock,
        note: input.note,
        requested_by: input.requestedBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  private requests() {
    return this.db
      .selectFrom('product_requests as r')
      .leftJoin('categories as c', 'c.id', 'r.category_id')
      .leftJoin('users as asker', 'asker.id', 'r.requested_by')
      .leftJoin('users as decider', 'decider.id', 'r.decided_by')
      .select([
        'r.id',
        'r.status',
        'r.name',
        'r.category_id',
        'c.name as category_name',
        'r.price',
        'r.vat_rate',
        'r.barcode',
        'r.origin_country',
        'r.photo_media_id',
        'r.stock',
        'r.note',
        'r.requested_by',
        'asker.name as requested_by_name',
        'r.requested_at',
        'decider.name as decided_by_name',
        'r.decided_at',
        'r.decision_note',
        'r.product_id',
      ]);
  }

  findById(id: number): Promise<ProductRequestRecord | undefined> {
    return this.requests().where('r.id', '=', id).executeTakeFirst();
  }

  findPending(): Promise<ProductRequestRecord[]> {
    return this.requests().where('r.status', '=', 'pending').orderBy('r.requested_at').execute();
  }

  /** Locks the row, so two people deciding at once can't both act. Run in a transaction. */
  async lockStatus(id: number): Promise<ProductRequestStatus | undefined> {
    const row = await this.db.selectFrom('product_requests').select('status').where('id', '=', id).forUpdate().executeTakeFirst();
    return row?.status;
  }

  async decide(id: number, decision: { status: ProductRequestStatus; by: number | null; note: string | null; productId: number | null }): Promise<void> {
    await this.db
      .updateTable('product_requests')
      .set({
        status: decision.status,
        decided_by: decision.by,
        decided_at: decision.status === 'pending' ? null : new Date(),
        decision_note: decision.note,
        product_id: decision.productId,
      })
      .where('id', '=', id)
      .execute();
  }
}
