import { roundMoney } from '../../utils/money.js';
import { normalise } from './statementFile.js';

/**
 * Suggesting what a bank statement line is, the way Xero does: by amount,
 * plus a name or number found in the line's text. Each suggestion says why
 * (the reasons), and is "sure" only when the amount fits and something else
 * points to it too, or a saved rule says so.
 */

export type Reason =
  | { key: 'sameAmount' }
  | { key: 'sumOfBills'; count: number }
  | { key: 'nameInText'; name: string }
  | { key: 'numberInText'; number: string }
  | { key: 'daysApart'; days: number }
  | { key: 'rule'; contains: string }
  | { key: 'depositWords' };

/** What confirming a line does. */
export type LineAction =
  | { kind: 'payBills'; supplierId: number; bills: Array<{ billId: number; amount: number }> }
  | { kind: 'linkPayment'; paymentId: number }
  | { kind: 'linkGroup'; groupId: number }
  | { kind: 'receive'; customerId: number; allocations: Array<{ documentId: number | null; amount: number }> }
  | { kind: 'linkReceipt'; entryId: number }
  | { kind: 'linkMove'; moveId: number }
  /** A new move: money in came from the other place, money out went to it; null is the owner. */
  | { kind: 'move'; otherPlaceId: number | null }
  | { kind: 'expense'; category: string; supplierId: number | null };

export interface Suggestion {
  action: LineAction;
  sure: boolean;
  reasons: Reason[];
  /** Who or what it is, for the sentence on screen. */
  label: { supplier?: string | null; customer?: string; numbers?: string[]; placeId?: number | null; category?: string };
  ruleId: number | null;
}

export interface LineToMatch {
  day: string;
  text: string;
  amount: number;
}

export interface OpenBill {
  id: number;
  supplierId: number;
  supplierName: string;
  number: string | null;
  issuedOn: string;
  left: number;
}

export interface OpenCustomerItem {
  customerId: number;
  customerName: string;
  documentId: number | null;
  number: string | null;
  date: string;
  left: number;
}

export interface Unlinked {
  id: number;
  day: string;
  amount: number;
  /** A supplier payment's or group's supplier, a receipt's customer, a move's other place. */
  name: string | null;
  numbers?: string[];
  /** A move's other place; null is the owner. */
  otherPlaceId?: number | null;
}

export interface Candidates {
  bills: OpenBill[];
  items: OpenCustomerItem[];
  /** Supplier payments from this place on one bill, not grouped, not yet on a line. */
  payments: Unlinked[];
  groups: Unlinked[];
  receipts: Unlinked[];
  /** Moves out of (amount below zero) or into this place, not yet on a line. */
  moves: Unlinked[];
  rules: Array<{ id: number; contains: string; direction: 'in' | 'out'; action: 'expense' | 'transfer' | 'owner'; category: string | null; supplierId: number | null; otherPlaceId: number | null }>;
  /** The shop's till, where cash deposited in the bank usually comes from. */
  shopTillId: number;
}

const LEGAL = new Set(['shpk', 'sh', 'p', 'k', 'llc', 'ltd', 'doo', 'sha', 'np', 'n', 'i', 'and', 'dhe', 'co', 'company', 'kompania', 'grup', 'group']);

/** Whether a name is in the text: each of its words (legal endings like Sh.p.k. left out), as whole words. */
export function nameIn(text: string, name: string | null): boolean {
  if (!name) return false;
  const words = normalise(name)
    .split(' ')
    .filter((word) => word.length >= 2 && !LEGAL.has(word));
  if (words.length === 0) return false;
  if (words.length === 1 && words[0]!.length < 4) return false;
  const padded = ` ${normalise(text)} `;
  return words.every((word) => padded.includes(` ${word} `));
}

/** Whether a document number is in the text ("1234/2026" in "Fat. nr 1234/2026"). Short numbers are too likely by chance. */
export function numberIn(text: string, number: string | null): boolean {
  if (!number) return false;
  const wanted = normalise(number);
  if (wanted.replace(/ /g, '').length < 4) return false;
  return ` ${normalise(text)} `.includes(` ${wanted} `);
}

const daysBetween = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Bills (oldest first) whose amounts left add up to exactly the amount: the oldest run first, else any few of them. */
export function billsAddingUpTo<T extends { left: number }>(bills: T[], amount: number): T[] | null {
  let total = 0;
  for (let index = 0; index < bills.length; index += 1) {
    total = roundMoney(total + bills[index]!.left);
    if (same(total, amount)) return bills.slice(0, index + 1);
    if (total > amount + 0.005) break;
  }
  const pool = bills.slice(0, 14);
  let found: T[] | null = null;
  const search = (start: number, picked: T[], sum: number) => {
    if (found) return;
    if (same(sum, amount) && picked.length > 0) {
      found = picked;
      return;
    }
    if (sum > amount + 0.005 || picked.length >= 6) return;
    for (let index = start; index < pool.length; index += 1) search(index + 1, [...picked, pool[index]!], roundMoney(sum + pool[index]!.left));
  };
  search(0, [], 0);
  return found;
}

function unlinkedMatches(line: LineToMatch, records: Unlinked[], amount: number, withinDays: number): Array<{ record: Unlinked; days: number }> {
  return records
    .filter((record) => same(record.amount, amount))
    .map((record) => ({ record, days: daysBetween(record.day, line.day) }))
    .filter((match) => match.days <= withinDays)
    .sort((a, b) => a.days - b.days);
}

const DEPOSIT_WORDS = ['depozit', 'depozite', 'depozitim', 'deposit', 'cash deposit', 'para te gatshme', 'derdhje', 'pagese ne para', 'arketim'];

/** Every suggestion for one line, the likeliest first. */
export function suggest(line: LineToMatch, candidates: Candidates): Suggestion[] {
  const out: Suggestion[] = [];
  const amount = Math.abs(line.amount);
  const moneyOut = line.amount < 0;
  const text = line.text;

  for (const rule of candidates.rules) {
    if (rule.direction !== (moneyOut ? 'out' : 'in')) continue;
    if (!` ${normalise(text)} `.includes(` ${normalise(rule.contains)}`)) continue;
    const reasons: Reason[] = [{ key: 'rule', contains: rule.contains }];
    if (rule.action === 'expense') {
      if (!moneyOut) continue;
      out.push({ action: { kind: 'expense', category: rule.category!, supplierId: rule.supplierId }, sure: true, reasons, label: { category: rule.category! }, ruleId: rule.id });
    } else {
      out.push({
        action: { kind: 'move', otherPlaceId: rule.action === 'owner' ? null : rule.otherPlaceId },
        sure: true,
        reasons,
        label: { placeId: rule.action === 'owner' ? null : rule.otherPlaceId },
        ruleId: rule.id,
      });
    }
  }

  // Records already in 4VD that only need linking: the strongest evidence after a rule.
  for (const { record, days } of unlinkedMatches(line, candidates.moves.filter((move) => move.amount !== 0 && (move.amount < 0) === moneyOut).map((move) => ({ ...move, amount: Math.abs(move.amount) })), amount, 4)) {
    out.push({ action: { kind: 'linkMove', moveId: record.id }, sure: false, reasons: [{ key: 'sameAmount' }, { key: 'daysApart', days }], label: { placeId: record.otherPlaceId ?? null }, ruleId: null });
  }
  if (moneyOut) {
    for (const { record, days, group } of [...unlinkedMatches(line, candidates.payments, amount, 7).map((match) => ({ ...match, group: false })), ...unlinkedMatches(line, candidates.groups, amount, 7).map((match) => ({ ...match, group: true }))]) {
      const named = nameIn(text, record.name);
      const reasons: Reason[] = [{ key: 'sameAmount' }, { key: 'daysApart', days }];
      if (named) reasons.push({ key: 'nameInText', name: record.name! });
      out.push({
        action: group ? { kind: 'linkGroup', groupId: record.id } : { kind: 'linkPayment', paymentId: record.id },
        sure: named,
        reasons,
        label: { supplier: record.name, numbers: record.numbers },
        ruleId: null,
      });
    }
  } else {
    for (const { record, days } of unlinkedMatches(line, candidates.receipts, amount, 7)) {
      const named = nameIn(text, record.name);
      const reasons: Reason[] = [{ key: 'sameAmount' }, { key: 'daysApart', days }];
      if (named) reasons.push({ key: 'nameInText', name: record.name! });
      out.push({ action: { kind: 'linkReceipt', entryId: record.id }, sure: named, reasons, label: { customer: record.name ?? '' }, ruleId: null });
    }
  }
  // A move is sure when it is the only one that fits.
  const moves = out.filter((suggestion) => suggestion.action.kind === 'linkMove');
  if (moves.length === 1) moves[0]!.sure = true;

  if (moneyOut) out.push(...billSuggestions(line, candidates.bills, amount));
  else out.push(...invoiceSuggestions(line, candidates.items, amount));

  if (!moneyOut && DEPOSIT_WORDS.some((word) => ` ${normalise(text)} `.includes(` ${word}`)) && !out.some((suggestion) => suggestion.action.kind === 'linkMove')) {
    out.push({ action: { kind: 'move', otherPlaceId: candidates.shopTillId }, sure: false, reasons: [{ key: 'depositWords' }], label: { placeId: candidates.shopTillId }, ruleId: null });
  }

  // Sure ones first; one line can only be sure about one thing.
  const sure = out.filter((suggestion) => suggestion.sure);
  if (sure.length > 1) {
    // A saved rule wins; two other sure answers mean neither is.
    const keep = sure[0]!.ruleId !== null ? sure[0] : null;
    for (const suggestion of sure) if (suggestion !== keep) suggestion.sure = false;
  }
  return [...out.filter((suggestion) => suggestion.sure), ...out.filter((suggestion) => !suggestion.sure)].slice(0, 5);
}

function billSuggestions(line: LineToMatch, bills: OpenBill[], amount: number): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (picked: OpenBill[], sure: boolean, reasons: Reason[]) => {
    const key = picked.map((bill) => bill.id).sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      action: { kind: 'payBills', supplierId: picked[0]!.supplierId, bills: picked.map((bill) => ({ billId: bill.id, amount: bill.left })) },
      sure,
      reasons,
      label: { supplier: picked[0]!.supplierName, numbers: picked.map((bill) => bill.number).filter((number): number is string => Boolean(number)) },
      ruleId: null,
    });
  };

  // Bill numbers in the text.
  const numbered = bills.filter((bill) => numberIn(line.text, bill.number));
  const bySupplier = new Map<number, OpenBill[]>();
  for (const bill of numbered) bySupplier.set(bill.supplierId, [...(bySupplier.get(bill.supplierId) ?? []), bill]);
  for (const group of bySupplier.values()) {
    const total = roundMoney(group.reduce((sum, bill) => sum + bill.left, 0));
    if (same(total, amount)) {
      add(group, true, [group.length > 1 ? { key: 'sumOfBills', count: group.length } : { key: 'sameAmount' }, ...group.map((bill) => ({ key: 'numberInText', number: bill.number! }) as Reason)]);
    }
  }

  // The supplier's name in the text: one bill, or several adding up, oldest first.
  const suppliers = new Map<number, OpenBill[]>();
  for (const bill of bills) suppliers.set(bill.supplierId, [...(suppliers.get(bill.supplierId) ?? []), bill]);
  for (const supplierBills of suppliers.values()) {
    const name = supplierBills[0]!.supplierName;
    if (!nameIn(line.text, name)) continue;
    const ordered = [...supplierBills].sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.id - b.id);
    const single = ordered.filter((bill) => same(bill.left, amount));
    if (single.length > 0) {
      for (const bill of single) add([bill], single.length === 1, [{ key: 'sameAmount' }, { key: 'nameInText', name }]);
      continue;
    }
    const picked = billsAddingUpTo(ordered, amount);
    if (picked) add(picked, true, [{ key: 'sumOfBills', count: picked.length }, { key: 'nameInText', name }]);
  }

  // The amount alone: a guess to check, never sure.
  for (const bill of bills.filter((candidate) => same(candidate.left, amount)).slice(0, 3)) add([bill], false, [{ key: 'sameAmount' }]);
  return out;
}

function invoiceSuggestions(line: LineToMatch, items: OpenCustomerItem[], amount: number): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (picked: OpenCustomerItem[], allocations: Array<{ documentId: number | null; amount: number }>, sure: boolean, reasons: Reason[]) => {
    const key = `${picked[0]!.customerId}:${allocations.map((allocation) => `${allocation.documentId}=${allocation.amount}`).join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      action: { kind: 'receive', customerId: picked[0]!.customerId, allocations },
      sure,
      reasons,
      label: { customer: picked[0]!.customerName, numbers: picked.map((item) => item.number).filter((number): number is string => Boolean(number)) },
      ruleId: null,
    });
  };
  const whole = (picked: OpenCustomerItem[]) => picked.map((item) => ({ documentId: item.documentId, amount: item.left }));

  const numbered = items.filter((item) => numberIn(line.text, item.number));
  const byCustomer = new Map<number, OpenCustomerItem[]>();
  for (const item of numbered) byCustomer.set(item.customerId, [...(byCustomer.get(item.customerId) ?? []), item]);
  for (const group of byCustomer.values()) {
    const total = roundMoney(group.reduce((sum, item) => sum + item.left, 0));
    if (same(total, amount)) add(group, whole(group), true, group.map((item) => ({ key: 'numberInText', number: item.number! }) as Reason));
  }

  const customers = new Map<number, OpenCustomerItem[]>();
  for (const item of items) customers.set(item.customerId, [...(customers.get(item.customerId) ?? []), item]);
  for (const customerItems of customers.values()) {
    const name = customerItems[0]!.customerName;
    if (!nameIn(line.text, name)) continue;
    const ordered = [...customerItems].sort((a, b) => a.date.localeCompare(b.date));
    const single = ordered.filter((item) => same(item.left, amount));
    if (single.length > 0) {
      for (const item of single) add([item], whole([item]), single.length === 1, [{ key: 'sameAmount' }, { key: 'nameInText', name }]);
      continue;
    }
    const picked = billsAddingUpTo(ordered, amount);
    if (picked) {
      add(picked, whole(picked), true, [{ key: 'sumOfBills', count: picked.length }, { key: 'nameInText', name }]);
      continue;
    }
    // Part of what they owe: spread over the oldest first, for a person to check.
    const owed = roundMoney(ordered.reduce((sum, item) => sum + item.left, 0));
    if (amount < owed) {
      const allocations: Array<{ documentId: number | null; amount: number }> = [];
      let rest = amount;
      for (const item of ordered) {
        if (rest <= 0) break;
        const part = roundMoney(Math.min(item.left, rest));
        allocations.push({ documentId: item.documentId, amount: part });
        rest = roundMoney(rest - part);
      }
      add(ordered.slice(0, allocations.length), allocations, false, [{ key: 'nameInText', name }]);
    }
  }

  for (const item of items.filter((candidate) => same(candidate.left, amount)).slice(0, 3)) add([item], whole([item]), false, [{ key: 'sameAmount' }]);
  return out;
}
