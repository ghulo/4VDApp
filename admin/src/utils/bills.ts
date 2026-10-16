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
  /** The VAT in the amount; empty when not known. */
  vat: string;
  note: string;
}

export const emptyBill = (amount = ''): BillDraft => ({ number: '', issuedOn: todayIso(), dueOn: '', amount, vat: '', note: '' });

export const toBillInput = (draft: BillDraft): BillInput => ({
  number: draft.number.trim() || null,
  issuedOn: draft.issuedOn,
  dueOn: draft.dueOn || null,
  amount: Number(draft.amount),
  vatAmount: draft.vat.trim() === '' ? null : Number(draft.vat),
  note: draft.note.trim() || null,
});

/** The VAT is optional, but when given it has to be less than the total. */
export const isVatValid = (draft: BillDraft) => draft.vat.trim() === '' || (Number(draft.vat) >= 0 && Number(draft.vat) < Number(draft.amount));

export const isBillValid = (draft: BillDraft) =>
  Number(draft.amount) > 0 && draft.issuedOn !== '' && (!draft.dueOn || draft.dueOn >= draft.issuedOn) && isVatValid(draft);

/** The VAT inside a VAT-inclusive total at a rate, to the cent. */
export const vatInside = (total: number, rate: number) => Math.round(((total * rate) / (100 + rate)) * 100) / 100;
