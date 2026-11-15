import { ConflictError } from '../../errors/httpErrors.js';
import type { TransactionalRepositories } from '../../repositories/TransactionManager.js';
import { roundMoney } from '../../utils/money.js';
import { YearClosedError } from '../vat/periodLock.js';
import { addMonths, monthStart } from './depreciation.js';

/**
 * How supplier bills and the fixed assets register stay together, inside the
 * bill's own transaction: a bill's equipment lines come in as assets; voiding
 * the bill takes them back out; a credit bill that gives one back to the
 * supplier marks it returned, and voiding that credit brings it back.
 */
export async function addBillAssets(repos: TransactionalRepositories, billId: number, actorId: number | null): Promise<void> {
  await repos.assets.addFromBill(billId, actorId);
}

/** Refuses when a stored month of these assets is in a closed year: dropping it would change that year. */
async function assertMonthsDroppable(repos: TransactionalRepositories, assetId: number, from: string | null = null): Promise<void> {
  const months = (await repos.assets.months(assetId)).filter((row) => from === null || row.month >= from);
  const closed = await repos.periods.closedYearsAmong([...new Set(months.map((row) => Number(row.month.slice(0, 4))))]);
  if (closed.length > 0) throw new YearClosedError(Math.min(...closed));
}

/** Before a bill or credit is voided. */
export async function voidBillAssets(repos: TransactionalRepositories, bill: { id: number; kind: string }, actorId: number, now: Date): Promise<void> {
  if (bill.kind === 'credit') {
    for (const asset of await repos.assets.returnedBy(bill.id)) {
      await repos.assets.undoDisposal(asset.id);
    }
    return;
  }
  for (const asset of await repos.assets.ofBill(bill.id)) {
    if (asset.disposal) throw new ConflictError(`${asset.name} from this bill was sold or removed. Undo that on its page first.`);
    await assertMonthsDroppable(repos, asset.id);
    await repos.assets.dropMonths(asset.id);
    await repos.assets.markVoided(asset.id, actorId, now);
  }
}

/**
 * A credit's equipment lines give assets back to the supplier: each takes the
 * asset from the original bill of the same kind and the same cost that is
 * still in use. One that matches none (a part refund) is left to the
 * accountant: the register keeps the asset as it was.
 */
export async function returnBillAssets(repos: TransactionalRepositories, creditId: number, originalBillId: number, day: string): Promise<void> {
  const lines = (await repos.bills.findLines([creditId])).filter((line) => line.kind === 'equipment');
  if (lines.length === 0) return;
  const open = (await repos.assets.ofBill(originalBillId)).filter((asset) => !asset.disposal);
  for (const line of lines) {
    const index = open.findIndex((asset) => asset.category === line.category && roundMoney(Number(asset.cost)) === roundMoney(Number(line.landed)));
    if (index < 0) continue;
    const [asset] = open.splice(index, 1);
    // Months after the one it went back in are no longer its.
    await assertMonthsDroppable(repos, asset!.id, addMonths(monthStart(day), 1));
    await repos.assets.dropMonths(asset!.id, addMonths(monthStart(day), 1));
    await repos.assets.dispose(asset!.id, {
      disposedOn: day < asset!.in_use_from ? asset!.in_use_from : day,
      disposal: 'returned',
      saleNet: null,
      saleVatRate: null,
      saleVat: null,
      buyerName: null,
      buyerNui: null,
      customerId: null,
      paidPlaceId: null,
      creditBillId: creditId,
      note: null,
    });
  }
}
