import type { CustomsInput, CustomsPaidMethod } from '../services/types';
import { todayIso } from './bills';

/** A customs paper as its form holds it: amounts as typed. */
export interface CustomsDraft {
  number: string;
  issuedOn: string;
  vat: string;
  duty: string;
  excise: string;
  method: CustomsPaidMethod;
}

export const emptyCustomsDraft = (): CustomsDraft => ({ number: '', issuedOn: todayIso(), vat: '', duty: '', excise: '', method: 'bank' });

const amount = (value: string) => (value.trim() === '' ? 0 : Number(value));

/** Dated today or before, no negative amounts, and something paid. */
export function customsDraftValid(draft: CustomsDraft): boolean {
  const numbers = [draft.vat, draft.duty, draft.excise].map(amount);
  return draft.issuedOn !== '' && draft.issuedOn <= todayIso() && numbers.every((value) => Number.isFinite(value) && value >= 0) && numbers.some((value) => value > 0);
}

export function customsInput(draft: CustomsDraft): CustomsInput {
  return {
    number: draft.number.trim() || null,
    issuedOn: draft.issuedOn,
    vat: amount(draft.vat),
    duty: amount(draft.duty),
    excise: amount(draft.excise),
    method: draft.method,
  };
}

const typed = (value: number | null | undefined) => (value && value > 0 ? String(value) : '');

/** What the scanner read off a declaration, as a draft to check. */
export function draftFromReading(reading: { number: string | null; issuedOn: string | null; customs?: { vat: number; duty: number; excise: number } | null }): CustomsDraft {
  const today = todayIso();
  return {
    number: reading.number ?? '',
    issuedOn: reading.issuedOn && reading.issuedOn <= today ? reading.issuedOn : today,
    vat: typed(reading.customs?.vat),
    duty: typed(reading.customs?.duty),
    excise: typed(reading.customs?.excise),
    method: 'bank',
  };
}
