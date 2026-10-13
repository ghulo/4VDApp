import type { ApprovalRepository, MyRequestRow } from '../repositories/ApprovalRepository.js';
import { en, type ServerMessages } from '../i18n/messages.js';
import { toIsoOrNull, toMoney } from './mappers.js';

export interface MyRequestDto {
  type: 'return' | 'write_off' | 'count' | 'sale' | 'product' | 'bill';
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
    return { ...counts, total: counts.returns + counts.writeOffs + counts.countLines + counts.productRequests };
  }

  /** Their recent requests, each described in the language of `t`. */
  async mine(userId: number, t: ServerMessages = en): Promise<MyRequestDto[]> {
    const since = new Date(Date.now() - MY_REQUESTS_DAYS * MS_PER_DAY);
    const rows = await this.approvalRepository.requestsBy(userId, since, MY_REQUESTS_LIMIT);
    return rows.map((row) => ({
      type: row.type,
      id: row.id,
      summary: describe(row, t),
      status: row.status,
      decisionNote: row.decision_note,
      requestedAt: row.requested_at.toISOString(),
      decidedAt: toIsoOrNull(row.decided_at),
    }));
  }
}

function describe(row: MyRequestRow, t: ServerMessages): string {
  const what = `${row.quantity} × ${row.product_name}`;
  const amount = toMoney(row.refund_amount ?? 0);
  switch (row.type) {
    case 'return':
      return t.myRequest.return({ what, refund: amount });
    case 'write_off':
      return t.myRequest.writeOff({ what, reason: t.writeOffReason[row.reason ?? ''] ?? row.reason ?? '' });
    case 'count':
      return t.myRequest.count(row.category_name);
    case 'sale':
      return t.myRequest.sale({ what, total: amount });
    case 'product':
      return t.myRequest.product({ name: row.product_name ?? '', price: amount });
    case 'bill':
      return t.myRequest.bill({ supplier: row.product_name, lines: row.quantity ?? 0 });
  }
}
