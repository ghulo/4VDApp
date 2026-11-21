import type { ProductUnit } from '../services/types';
import { allowsParts } from './units';
import { inGrams } from './format';

/** What was typed for one delivery: how many came and the expiry date, per order line. */
export interface DeliveryDraft {
  came: Record<number, string>;
  expires: Record<number, string>;
}

/** One typed "how many came": a number, blank (not typed yet), or not a number this product can take. */
export type Received = { kind: 'number'; value: number } | { kind: 'blank' } | { kind: 'invalid' };

/**
 * Reads a typed quantity. Blank is "not entered", never 0, so an emptied box
 * can't put nothing into stock by mistake. A piece takes whole numbers; kg, l,
 * m and m² take parts to the gram, with a dot or the Albanian comma ("2,5").
 */
export function parseReceived(text: string, unit: ProductUnit | undefined): Received {
  const typed = text.trim().replace(',', '.');
  if (typed === '') return { kind: 'blank' };
  if (!/^\d+(\.\d+)?$/.test(typed) && !/^\.\d+$/.test(typed)) return { kind: 'invalid' };
  const value = Number(typed);
  if (!Number.isFinite(value) || value < 0) return { kind: 'invalid' };
  if (allowsParts(unit) ? !inGrams(value) : !Number.isInteger(value)) return { kind: 'invalid' };
  return { kind: 'number', value };
}

/**
 * Whose drafts: the business, and on the delivery page the person too
 * ("<business>:<user>"), so a switch of person or business never sends one
 * person's typing as another's.
 */
export type DraftScope = string | number | null | undefined;

const KEY = (scope: DraftScope) => `4vd.deliveryDrafts.${scope ?? 'none'}`;

/** The drafts kept in this tab for one business. Storage can be full or blocked: then nothing is kept, and nothing breaks. */
export function loadDrafts(scope: DraftScope): Record<number, DeliveryDraft> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY(scope)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const drafts: Record<number, DeliveryDraft> = {};
    for (const [id, draft] of Object.entries(parsed as Record<string, unknown>)) {
      if (!draft || typeof draft !== 'object') continue;
      const { came, expires } = draft as Partial<DeliveryDraft>;
      drafts[Number(id)] = { came: strings(came), expires: strings(expires) };
    }
    return drafts;
  } catch {
    return {};
  }
}

export function saveDrafts(scope: DraftScope, drafts: Record<number, DeliveryDraft>): void {
  try {
    if (Object.keys(drafts).length === 0) sessionStorage.removeItem(KEY(scope));
    else sessionStorage.setItem(KEY(scope), JSON.stringify(drafts));
  } catch {
    // Full or blocked storage: the drafts stay in memory for this visit.
  }
}

/** Only the drafts of orders still on their way (one put into stock or cancelled elsewhere is dropped). */
export function keepListed(drafts: Record<number, DeliveryDraft>, orderIds: number[]): Record<number, DeliveryDraft> {
  const listed = new Set(orderIds);
  const kept = Object.entries(drafts).filter(([id]) => listed.has(Number(id)));
  return kept.length === Object.keys(drafts).length ? drafts : Object.fromEntries(kept);
}

function strings(value: unknown): Record<number, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, text]) => typeof text === 'string')) as Record<number, string>;
}

/** A delivery that came without an order, as typed so far: the supplier, the key of its save, and each product with how many came. */
export interface ArrivalDraft {
  supplierId: number;
  /** Made once per delivery and sent with every try, so a save sent twice puts the goods in once. */
  key: string;
  lines: Array<{ productId: number; name: string; unit: ProductUnit; came: string; expires: string }>;
  /**
   * What Save sent, frozen until an answer says it went in or was refused:
   * the same key always goes with the same counts, so a resend can't be told
   * "done" for counts that were changed after the first copy went in.
   */
  sent?: ArrivalLine[];
}

/** One product of a delivery without an order, as the server takes it. */
export interface ArrivalLine {
  productId: number;
  quantity: number;
  expiresOn: string | null;
}

const ARRIVAL_KEY = (scope: DraftScope) => `4vd.arrivalDraft.${scope ?? 'none'}`;

/** The no-order delivery being typed in this tab for one business, if any. */
export function loadArrival(scope: DraftScope): ArrivalDraft | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ARRIVAL_KEY(scope)) ?? 'null') as Partial<ArrivalDraft> | null;
    if (!parsed || typeof parsed.supplierId !== 'number' || typeof parsed.key !== 'string' || !Array.isArray(parsed.lines)) return null;
    const lines = parsed.lines.filter(
      (line): line is ArrivalDraft['lines'][number] => !!line && typeof line.productId === 'number' && typeof line.name === 'string' && typeof line.came === 'string',
    );
    const sent = Array.isArray(parsed.sent)
      ? parsed.sent.filter((line): line is ArrivalLine => !!line && typeof line.productId === 'number' && typeof line.quantity === 'number')
      : undefined;
    return {
      supplierId: parsed.supplierId,
      key: parsed.key,
      lines: lines.map((line) => ({ ...line, unit: line.unit ?? 'piece', expires: typeof line.expires === 'string' ? line.expires : '' })),
      ...(sent && sent.length > 0 && { sent: sent.map((line) => ({ ...line, expiresOn: typeof line.expiresOn === 'string' ? line.expiresOn : null })) }),
    };
  } catch {
    return null;
  }
}

/** Keep it (null: it went into stock or was dropped). Full or blocked storage keeps it in memory only. */
export function saveArrival(scope: DraftScope, draft: ArrivalDraft | null): void {
  try {
    if (draft === null) sessionStorage.removeItem(ARRIVAL_KEY(scope));
    else sessionStorage.setItem(ARRIVAL_KEY(scope), JSON.stringify(draft));
  } catch {
    // Kept in memory for this visit.
  }
}

/**
 * Where the delivery page stopped, kept in the tab so a reload carries on:
 * an order ticked off whose answer hasn't come yet (sent again with the same
 * counts, which the server takes once), or a delivery in stock whose bill
 * photo is still to send.
 */
export type DeliveryStep =
  | { kind: 'sending'; orderId: number; supplierName: string; requestKey?: string; lines: Array<{ lineId: number; receivedQuantity: number; expiresOn: string | null }> }
  | { kind: 'photo'; orderId: number; message: string };

const STEP_KEY = (scope: DraftScope) => `4vd.deliveryStep.${scope ?? 'none'}`;

export function loadStep(scope: DraftScope): DeliveryStep | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STEP_KEY(scope)) ?? 'null') as Partial<DeliveryStep> | null;
    if (!parsed || typeof parsed.orderId !== 'number') return null;
    if (parsed.kind === 'photo' && typeof parsed.message === 'string') return { kind: 'photo', orderId: parsed.orderId, message: parsed.message };
    if (parsed.kind === 'sending' && typeof parsed.supplierName === 'string' && Array.isArray(parsed.lines)) {
      const lines = parsed.lines.filter((line) => !!line && typeof line.lineId === 'number' && typeof line.receivedQuantity === 'number');
      return {
        kind: 'sending',
        orderId: parsed.orderId,
        supplierName: parsed.supplierName,
        ...(typeof parsed.requestKey === 'string' && { requestKey: parsed.requestKey }),
        lines: lines.map((line) => ({ ...line, expiresOn: typeof line.expiresOn === 'string' ? line.expiresOn : null })) };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveStep(scope: DraftScope, step: DeliveryStep | null): void {
  try {
    if (step === null) sessionStorage.removeItem(STEP_KEY(scope));
    else sessionStorage.setItem(STEP_KEY(scope), JSON.stringify(step));
  } catch {
    // Kept in memory for this visit.
  }
}
