import type { DatabaseClient } from '../database/connection.js';
import type { BillScanStatus } from '../database/types.js';

export interface BillScanRecord {
  id: number;
  status: BillScanStatus;
  media_ids: string[];
  reading: unknown;
  scanned_by_name: string | null;
  scanned_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  bill_id: number | null;
  order_id: number | null;
}

export interface SupplierCodeRecord {
  code: string;
  product_id: number;
  units_per_pack: number;
}

/** Scanned bills waiting for a check, and the supplier codes learned from confirmed ones. */
export class BillScanRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(input: { mediaIds: string[]; reading: unknown; scannedBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('bill_scans')
      .values({ media_ids: input.mediaIds, reading: JSON.stringify(input.reading), scanned_by: input.scannedBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  private scans() {
    return this.db
      .selectFrom('bill_scans as s')
      .leftJoin('users as scanner', 'scanner.id', 's.scanned_by')
      .leftJoin('users as decider', 'decider.id', 's.decided_by')
      .select([
        's.id',
        's.status',
        's.media_ids',
        's.reading',
        'scanner.name as scanned_by_name',
        's.scanned_at',
        'decider.name as decided_by_name',
        's.decided_at',
        's.bill_id',
        's.order_id',
      ]);
  }

  async findById(id: number): Promise<BillScanRecord | undefined> {
    return this.scans().where('s.id', '=', id).executeTakeFirst();
  }

  /** Holds the scan until the transaction ends, so two people can't confirm it twice. */
  async lock(id: number): Promise<void> {
    await this.db.selectFrom('bill_scans').select('id').where('id', '=', id).forUpdate().execute();
  }

  /** Oldest first: whoever waited longest gets checked first. */
  async findWaiting(): Promise<BillScanRecord[]> {
    return this.scans().where('s.status', '=', 'waiting').orderBy('s.scanned_at').execute();
  }

  async decide(id: number, input: { status: 'confirmed' | 'discarded'; by: number; at: Date; billId?: number; orderId?: number }): Promise<void> {
    await this.db
      .updateTable('bill_scans')
      .set({ status: input.status, decided_by: input.by, decided_at: input.at, bill_id: input.billId ?? null, order_id: input.orderId ?? null })
      .where('id', '=', id)
      .execute();
  }

  async codesFor(supplierId: number): Promise<SupplierCodeRecord[]> {
    return this.db.selectFrom('supplier_product_codes').select(['code', 'product_id', 'units_per_pack']).where('supplier_id', '=', supplierId).execute();
  }

  /** Codes are kept lowercase so "ART-1" and "art-1" are one code. */
  async rememberCode(input: { supplierId: number; code: string; productId: number; unitsPerPack: number; at: Date }): Promise<void> {
    const code = input.code.trim().toLowerCase();
    await this.db
      .insertInto('supplier_product_codes')
      .values({ supplier_id: input.supplierId, code, product_id: input.productId, units_per_pack: input.unitsPerPack, updated_at: input.at })
      .onConflict((conflict) =>
        conflict.columns(['supplier_id', 'code']).doUpdateSet({ product_id: input.productId, units_per_pack: input.unitsPerPack, updated_at: input.at }),
      )
      .execute();
  }
}
