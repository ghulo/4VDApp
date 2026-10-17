import type { BillInput, BillLine, BillLineInput, BillLineKind, Supplier } from '../services/types';

/** A product chosen on a bill line: what the form needs to know about it. */
export interface LineProduct {
  id: number;
  name: string;
  vatRate: number;
  costPrice: number | null;
}

/** One line of the bill form as it is being typed: every number a string. */
export interface DraftLine {
  key: number;
  kind: BillLineKind;
  product: LineProduct | null;
  quantity: string;
  unitPrice: string;
  /** A cost's or equipment's category. */
  category: string;
  description: string;
  /** A cost's or equipment's amount. */
  amount: string;
  vatRate: string;
  /** On a return or credit: whether this line is part of it, and the most it can be. */
  include?: boolean;
  max?: number;
}

let nextKey = 1;
export const lineKey = () => nextKey++;

/** A new line, started the way the supplier's bills usually are. */
export const emptyLine = (supplier?: Supplier | null): DraftLine => {
  const kind = supplier?.usualKind ?? 'product';
  return {
    key: lineKey(),
    kind,
    product: null,
    quantity: '1',
    unitPrice: '',
    category: kind === 'cost' ? (supplier?.usualCategory ?? 'other') : kind === 'equipment' ? (supplier?.usualCategory ?? 'equipment') : '',
    description: '',
    amount: '',
    vatRate: String(supplier?.usualVatRate ?? 18),
  };
};

/** Switching a line's kind keeps what still fits and picks a category for the new kind. */
export const withKind = (line: DraftLine, kind: BillLineKind): DraftLine => ({
  ...line,
  kind,
  category: kind === 'cost' ? 'other' : kind === 'equipment' ? 'equipment' : '',
  vatRate: kind === 'product' && line.product ? String(line.product.vatRate) : line.vatRate,
});

const positive = (text: string) => text.trim() !== '' && Number(text) > 0;

/** A line is finished when it says what it is and how much. */
export const isLineDone = (line: DraftLine) =>
  line.kind === 'product'
    ? line.product !== null && Number.isInteger(Number(line.quantity)) && Number(line.quantity) > 0 && (line.max === undefined || Number(line.quantity) <= line.max) && positive(line.unitPrice)
    : line.category !== '' && positive(line.amount) && (line.max === undefined || Number(line.amount) <= line.max);

export const toLineInput = (line: DraftLine): BillLineInput =>
  line.kind === 'product'
    ? { kind: 'product', productId: line.product!.id, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), vatRate: Number(line.vatRate) }
    : { kind: line.kind, category: line.category, description: line.description.trim() || null, amount: Number(line.amount), vatRate: Number(line.vatRate) };

/** A bill's saved line as a return or credit line, at the price on the paper. */
export const lineFromBill = (line: BillLine, pricesIncludeVat: boolean): DraftLine => {
  const paper = pricesIncludeVat ? line.gross : line.net;
  const quantity = line.quantity ?? 1;
  return {
    key: lineKey(),
    kind: line.kind,
    product: line.productId === null ? null : { id: line.productId, name: line.productName ?? '', vatRate: line.vatRate, costPrice: null },
    quantity: String(quantity),
    unitPrice: String(line.unitPrice ?? Math.round((paper / quantity) * 10_000) / 10_000),
    category: line.category ?? '',
    description: line.description ?? '',
    amount: String(paper),
    vatRate: String(line.vatRate),
    include: true,
    max: line.kind === 'product' ? quantity : paper,
  };
};

/** What a line comes to with its VAT, the way the server rounds it (each line to the cent). */
export const lineGross = (line: DraftLine, pricesIncludeVat: boolean) => {
  const paper = line.kind === 'product' ? Number(line.quantity) * Number(line.unitPrice) : Number(line.amount);
  const gross = pricesIncludeVat ? paper : paper * (1 + Number(line.vatRate) / 100);
  return Math.round(gross * 100) / 100;
};

/** "a, b and c" in the reader's language. */
export const joinParts = (parts: string[], and: string) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}`;

export const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

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
