import type { Catalogue } from '../i18n/en';

/**
 * The server stores why a return waits in English ("refund over €50").
 * Recognise its three kinds so they read in the current language; anything
 * else is shown as the server wrote it.
 */
export function describeReason(t: Catalogue, reason: string): string {
  const refund = /^refund over (.+)$/.exec(reason);
  if (refund) return t.approvals.reasons.refundOver(refund[1]!);
  const late = /^sold more than (\d+) days ago$/.exec(reason);
  if (late) return t.approvals.reasons.soldDaysAgo(late[1]!);
  if (reason === 'damaged item') return t.approvals.reasons.damaged;
  return reason;
}
