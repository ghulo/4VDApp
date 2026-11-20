import type { Catalogue } from '../i18n/en';
import type { RefundByInput, RefundInfo } from '../services/types';
import { formatMoney } from './format';
import { cleanIban, isIbanOrEmpty } from './iban';
import { allBy, defaultParts, partsTotal, type RefundMethod, type RefundParts, singleMethod } from './refundSplit';

/** What someone chose on the "How does the money go back?" step (components/RefundMoney). */
export interface RefundChoice {
  mode: RefundMethod | 'split';
  /** Typed split amounts; until someone types, the split follows the sale's. */
  split: Record<RefundMethod, string> | null;
  terminalDone: boolean;
  approvalCode: string;
  customerName: string;
  iban: string;
}

/** Where a refund starts: the way the sale was paid. */
export function initialChoice(info: RefundInfo): RefundChoice {
  const usual = singleMethod(defaultParts(info, 1));
  return { mode: usual ?? 'split', split: null, terminalDone: false, approvalCode: '', customerName: info.tabCustomer ?? '', iban: '' };
}

/** The euros going back each way for this refund. */
export function partsOf(choice: RefundChoice, info: RefundInfo, amount: number): RefundParts {
  if (choice.mode !== 'split') return allBy(choice.mode, amount);
  if (choice.split === null) return defaultParts(info, amount);
  const typed = (value: string) => Math.max(0, Math.round((Number(value.replace(',', '.')) || 0) * 100) / 100);
  return { cash: typed(choice.split.cash), card: typed(choice.split.card), transfer: typed(choice.split.transfer), tab: typed(choice.split.tab) };
}

/** Whether the owner must approve before the money moves, from what the server said about this person. */
export function waitsForOwner(info: RefundInfo, amounts: number[], damaged: boolean): boolean {
  if (info.approval === null) return false;
  return damaged || info.approval.tooOld || amounts.some((amount) => amount > info.approval!.limit);
}

/** What stops this refund from being saved, in words, or null. */
export function refundProblem(t: Catalogue, choice: RefundChoice, parts: RefundParts, amount: number, waits: boolean): string | null {
  const sum = partsTotal(parts);
  if (Math.round(sum * 100) !== Math.round(amount * 100)) return t.refundMoney.partsWrong(formatMoney(sum), formatMoney(amount));
  if (parts.transfer > 0 && !choice.customerName.trim()) return t.refundMoney.nameNeeded;
  if (parts.transfer > 0 && !isIbanOrEmpty(choice.iban)) return t.refundMoney.ibanWrong;
  if (parts.card > 0 && !waits && !choice.terminalDone) return t.refundMoney.terminalNotDone;
  return null;
}

/** What the server is told: the card, transfer and tab parts (the rest is cash). */
export function refundByInput(choice: RefundChoice, parts: RefundParts, batch: string | null): RefundByInput {
  return {
    card: parts.card,
    transfer: parts.transfer,
    tab: parts.tab,
    approvalCode: parts.card > 0 ? choice.approvalCode.trim() || null : null,
    customerName: choice.customerName.trim() || null,
    iban: parts.transfer > 0 ? cleanIban(choice.iban) || null : null,
    batch,
  };
}

