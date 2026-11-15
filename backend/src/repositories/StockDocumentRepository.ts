import type { DatabaseClient } from '../database/connection.js';
import type { StockDocumentDirection, StockDocumentReason } from '../database/types.js';

/** Writes of stock in and stock out documents; reads are in StockDocumentService. */
export class StockDocumentRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(document: {
    number: string;
    direction: StockDocumentDirection;
    reason: StockDocumentReason;
    day: string;
    note: string | null;
    createdBy: number;
    locationId: number;
  }): Promise<number> {
    const row = await this.db
      .insertInto('stock_documents')
      .values({ number: document.number, direction: document.direction, reason: document.reason, day: document.day, note: document.note, created_by: document.createdBy, location_id: document.locationId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async addLine(line: { documentId: number; productId: number; quantity: number; unitCost: number | null }): Promise<void> {
    await this.db
      .insertInto('stock_document_lines')
      .values({ document_id: line.documentId, product_id: line.productId, quantity: line.quantity, unit_cost: line.unitCost })
      .execute();
  }

  /** Marks it voided; false when it already was. */
  async markVoided(id: number, actorId: number, at: Date): Promise<boolean> {
    const result = await this.db.updateTable('stock_documents').set({ voided_at: at, voided_by: actorId }).where('id', '=', id).where('voided_at', 'is', null).executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
