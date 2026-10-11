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
  confirmation: unknown;
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
        's.confirmation',
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

  async decide(
    id: number,
    input: { status: 'confirmed' | 'discarded'; by: number; at: Date; billId?: number; orderId?: number; confirmation?: unknown },
  ): Promise<void> {
    await this.db
      .updateTable('bill_scans')
      .set({
        status: input.status,
        decided_by: input.by,
        decided_at: input.at,
        bill_id: input.billId ?? null,
        order_id: input.orderId ?? null,
        ...(input.confirmation !== undefined && { confirmation: JSON.stringify(input.confirmation) }),
      })
      .where('id', '=', id)
      .execute();
  }

  /** Back to waiting; the last confirmation stays so the check page can start from it. */
  async reopen(id: number): Promise<void> {
    await this.db
      .updateTable('bill_scans')
      .set({ status: 'waiting', decided_by: null, decided_at: null, bill_id: null, order_id: null })
      .where('id', '=', id)
      .execute();
  }

  async findCode(supplierId: number, code: string): Promise<SupplierCodeRecord | undefined> {
    return this.db
      .selectFrom('supplier_product_codes')
      .select(['code', 'product_id', 'units_per_pack'])
      .where('supplier_id', '=', supplierId)
      .where('code', '=', code.trim().toLowerCase())
      .executeTakeFirst();
  }

  async forgetCode(supplierId: number, code: string): Promise<void> {
    await this.db.deleteFrom('supplier_product_codes').where('supplier_id', '=', supplierId).where('code', '=', code.trim().toLowerCase()).execute();
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
