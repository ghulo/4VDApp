import type { BillInput } from '../services/types';

/** Today on this computer's calendar, as date inputs want it. */
export const todayIso = () => new Date().toLocaleDateString('en-CA');
export const addDaysIso = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const BILL_STATUS_TONE = { unpaid: 'warn', partly_paid: 'info', paid: 'ok', void: 'neutral' } as const;

/** A bill as its form holds it: every field a string while typing. */
export interface BillDraft {
  number: string;
  issuedOn: string;
  dueOn: string;
  amount: string;
  note: string;
}

export const emptyBill = (amount = ''): BillDraft => ({ number: '', issuedOn: todayIso(), dueOn: '', amount, note: '' });

export const toBillInput = (draft: BillDraft): BillInput => ({
  number: draft.number.trim() || null,
  issuedOn: draft.issuedOn,
  dueOn: draft.dueOn || null,
  amount: Number(draft.amount),
  note: draft.note.trim() || null,
});

export const isBillValid = (draft: BillDraft) => Number(draft.amount) > 0 && draft.issuedOn !== '' && (!draft.dueOn || draft.dueOn >= draft.issuedOn);
