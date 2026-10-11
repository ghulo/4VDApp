import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface MyRequestRow {
  type: 'return' | 'write_off' | 'count' | 'sale' | 'product' | 'bill';
  id: number;
  product_name: string | null;
  quantity: number | null;
  /** The refund for a return, the total for a sale. */
  refund_amount: string | null;
  reason: string | null;
  category_name: string | null;
  status: string;
  decision_note: string | null;
  requested_at: Date;
  decided_at: Date | null;
}

/** Read-only queries across returns, write-offs and counts for the approvals inbox. */
export class ApprovalRepository {
  constructor(private readonly db: DatabaseClient) {}

  async pendingCounts(): Promise<{ returns: number; writeOffs: number; countLines: number; productRequests: number }> {
    const result = await sql<{ returns: string; write_offs: string; count_lines: string; product_requests: string }>`
      select
        (select count(*) from returns where status = 'pending') as returns,
        (select count(*) from write_offs where status = 'pending') as write_offs,
        (select count(*) from stock_count_lines l join stock_counts c on c.id = l.count_id
          where l.status = 'pending' and c.status = 'submitted') as count_lines,
        (select count(*) from product_requests where status = 'pending') as product_requests
    `.execute(this.db);
    const row = result.rows[0]!;
    return {
      returns: Number(row.returns),
      writeOffs: Number(row.write_offs),
      countLines: Number(row.count_lines),
      productRequests: Number(row.product_requests),
    };
  }

  /**
   * What this person asked for since `since`: their returns, write-offs they
   * reported (not the ones created from a damaged return) and counts they submitted.
   */
  async requestsBy(userId: number, since: Date, limit: number): Promise<MyRequestRow[]> {
    const result = await sql<MyRequestRow>`
      select * from (
        select 'return' as type, r.id, p.name as product_name, r.quantity, r.refund_amount, null as reason,
               null as category_name,
               case when r.undone_at is not null then 'undone' else r.status end as status,
               case when r.undone_at is not null then r.undo_note else r.decision_note end as decision_note,
               r.requested_at, coalesce(r.undone_at, r.decided_at) as decided_at
        from returns r join sales s on s.id = r.sale_id join products p on p.id = s.product_id
        where r.requested_by = ${userId} and r.requested_at >= ${since}
        union all
        select 'write_off', w.id, p.name, w.quantity, null, w.reason, null,
               case when w.undone_at is not null then 'undone' else w.status end,
               case when w.undone_at is not null then w.undo_note else w.decision_note end,
               w.requested_at, coalesce(w.undone_at, w.decided_at)
        from write_offs w join products p on p.id = w.product_id
        where w.requested_by = ${userId} and w.return_id is null and w.requested_at >= ${since}
        union all
        -- Sales only show up here once someone undid them, so the seller knows why.
        select 'sale', s.id, p.name, s.quantity_sold, s.total_amount, null, null, 'undone', s.undo_note, s.sale_date, s.undone_at
        from sales s join products p on p.id = s.product_id
        where s.sold_by = ${userId} and s.undone_at is not null and s.undone_at >= ${since}
        union all
        select 'count', c.id, null, null, null, null, cat.name, c.status, null, c.submitted_at, c.closed_at
        from stock_counts c left join categories cat on cat.id = c.category_id
        where c.submitted_by = ${userId} and c.submitted_at >= ${since}
        union all
        select 'product', pr.id, pr.name, pr.stock, pr.price, null, null, pr.status, pr.decision_note, pr.requested_at, pr.decided_at
        from product_requests pr
        where pr.requested_by = ${userId} and pr.requested_at >= ${since}
        union all
        -- A scanned bill reads as a request too: waiting until someone checks it.
        select 'bill', b.id, b.reading -> 'supplier' ->> 'name', jsonb_array_length(b.reading -> 'lines'), null, null, null,
               case b.status when 'waiting' then 'pending' when 'confirmed' then 'approved' else 'rejected' end,
               null, b.scanned_at, b.decided_at
        from bill_scans b
        where b.scanned_by = ${userId} and b.scanned_at >= ${since}
      ) requests
      order by requested_at desc, id desc
      limit ${limit}
    `.execute(this.db);
    return result.rows;
  }
}
