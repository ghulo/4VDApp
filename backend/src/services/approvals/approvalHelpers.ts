import { ConflictError } from '../../errors/httpErrors.js';
import { NOTIFICATION_TYPES } from '../../constants/notifications.js';
import type { NotificationSubject } from '../../repositories/NotificationRepository.js';
import type { TransactionalRepositories } from '../../repositories/TransactionManager.js';
import { OVERSEER_ROLES } from '../../utils/roles.js';
import type { ApprovalKind, ServerMessages } from '../../i18n/messages.js';

/** Tell every admin something is waiting in the Approvals inbox. */
export function notifyAdminsOfPending(
  repos: TransactionalRepositories,
  kind: ApprovalKind,
  subject: NotificationSubject,
  message: (t: ServerMessages) => string,
) {
  return repos.notifications.createForRoles(OVERSEER_ROLES, {
    type: NOTIFICATION_TYPES.APPROVAL,
    subject,
    write: (t) => ({ title: t.pendingTitle(kind), message: message(t) }),
  });
}

/** Once a request is decided, its "waiting for approval" alerts are no longer news for anyone. */
export function closePendingAlerts(repos: TransactionalRepositories, subject: NotificationSubject) {
  return repos.notifications.markSubjectRead(subject);
}

/** Tell the person who asked what the owner decided. Admins deciding their own requests get nothing. */
export async function notifyRequester(
  repos: TransactionalRepositories,
  requestedBy: number | null,
  decidedBy: number,
  write: (t: ServerMessages) => { title: string; message: string },
): Promise<void> {
  if (requestedBy === null || requestedBy === decidedBy) return;
  await repos.notifications.createForUser(requestedBy, { type: NOTIFICATION_TYPES.APPROVAL_DECISION, write });
}

/** Approving or rejecting twice (double click, two admins) must not apply twice. */
export function assertPending(status: string, what: string): void {
  if (status !== 'pending') throw new ConflictError(`This ${what} was already ${status}`);
}
