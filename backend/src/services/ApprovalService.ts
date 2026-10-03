import type { ApprovalRepository, MyRequestRow } from '../repositories/ApprovalRepository.js';
import { formatEuro } from '../utils/money.js';
import { toIsoOrNull, toMoney } from './mappers.js';

export interface MyRequestDto {
  type: 'return' | 'write_off' | 'count' | 'sale';
  id: number;
  /** A sentence the employee recognises, e.g. "Return of 2 × Paint, refund €38.00". */
  summary: string;
  /** `undone` when someone undid it; `decisionNote` then holds their reason. */
  status: string;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

const MY_REQUESTS_DAYS = 30;
const MY_REQUESTS_LIMIT = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class ApprovalService {
  constructor(private readonly approvalRepository: ApprovalRepository) {}

  async summary() {
    const counts = await this.approvalRepository.pendingCounts();
    return { ...counts, total: counts.returns + counts.writeOffs + counts.countLines };
  }

  async mine(userId: number): Promise<MyRequestDto[]> {
    const since = new Date(Date.now() - MY_REQUESTS_DAYS * MS_PER_DAY);
    const rows = await this.approvalRepository.requestsBy(userId, since, MY_REQUESTS_LIMIT);
    return rows.map((row) => ({
      type: row.type,
      id: row.id,
      summary: describe(row),
      status: row.status,
      decisionNote: row.decision_note,
      requestedAt: row.requested_at.toISOString(),
      decidedAt: toIsoOrNull(row.decided_at),
    }));
  }
}

function describe(row: MyRequestRow): string {
  switch (row.type) {
    case 'return':
      return `Return of ${row.quantity} × ${row.product_name}, refund ${formatEuro(toMoney(row.refund_amount ?? 0))}`;
    case 'write_off':
      return `${row.quantity} × ${row.product_name} (${row.reason})`;
    case 'count':
      return `Stock count of ${row.category_name ?? 'the whole shop'}`;
    case 'sale':
      return `Sale of ${row.quantity} × ${row.product_name}, ${formatEuro(toMoney(row.refund_amount ?? 0))}`;
  }
}
