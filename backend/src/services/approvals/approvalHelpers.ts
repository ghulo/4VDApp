import { ConflictError } from '../../errors/httpErrors.js';
import type { TransactionalRepositories } from '../../repositories/TransactionManager.js';

export const APPROVAL_NOTIFICATION_TYPE = 'approval';

/** Tell every admin something is waiting in the Approvals inbox. */
export function notifyAdminsOfPending(repos: TransactionalRepositories, what: string, message: string) {
  return repos.notifications.createForRoles(['admin'], {
    title: `New ${what} waiting for approval`,
    message,
    type: APPROVAL_NOTIFICATION_TYPE,
  });
}

/** Tell the person who asked what the owner decided. Admins deciding their own requests get nothing. */
export async function notifyRequester(
  repos: TransactionalRepositories,
  requestedBy: number | null,
  decidedBy: number,
  title: string,
  message: string,
): Promise<void> {
  if (requestedBy === null || requestedBy === decidedBy) return;
  await repos.notifications.createForUser(requestedBy, { title, message, type: APPROVAL_NOTIFICATION_TYPE });
}

/** Approving or rejecting twice (double click, two admins) must not apply twice. */
export function assertPending(status: string, what: string): void {
  if (status !== 'pending') throw new ConflictError(`This ${what} was already ${status}`);
}
