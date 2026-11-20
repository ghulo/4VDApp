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

const KEY = (businessId: number | null | undefined) => `4vd.deliveryDrafts.${businessId ?? 'none'}`;

/** The drafts kept in this tab for one business. Storage can be full or blocked: then nothing is kept, and nothing breaks. */
export function loadDrafts(businessId: number | null | undefined): Record<number, DeliveryDraft> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY(businessId)) ?? '{}');
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

export function saveDrafts(businessId: number | null | undefined, drafts: Record<number, DeliveryDraft>): void {
  try {
    if (Object.keys(drafts).length === 0) sessionStorage.removeItem(KEY(businessId));
    else sessionStorage.setItem(KEY(businessId), JSON.stringify(drafts));
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
