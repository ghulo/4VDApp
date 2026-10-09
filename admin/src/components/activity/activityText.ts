import type { Catalogue } from '../../i18n/en';
import type { UndoEffect } from '../../services/types';
import { formatDateWith, formatMoney } from '../../utils/format';

type FieldName = keyof Catalogue['undo']['fields'];

const MONEY_FIELDS = new Set(['price', 'costPrice', 'refundApprovalLimit', 'cashFloatShop']);
/** Fields whose values read well on their own; the rest just "go back to how they were". */
const PLAIN_FIELDS = new Set(['name', 'sku', 'reorderLevel', 'returnWindowDays', 'minimumMarginPercent', 'dailySummaryHour']);

const signed = (n: number, text: string) => `${n > 0 ? '+' : '−'}${text}`;

function valueText(t: Catalogue, field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return t.undo.nothing;
  if (MONEY_FIELDS.has(field)) return formatMoney(Number(value));
  if (field === 'isActive') return value ? t.undo.shown : t.undo.hidden;
  return String(value);
}

/**
 * What an undo (or restore) does, one plain sentence per effect:
 * "+2 Oak Chair back in stock", "−€178.00 from Saturday 3 October",
 * "Price goes back from €79.00 to €89.00". A restore does the opposite.
 */
export function effectSentence(t: Catalogue, effect: UndoEffect, mode: 'undo' | 'restore' = 'undo'): string[] {
  const flip = mode === 'restore' ? -1 : 1;
  const lines: string[] = [];
  if (effect.stock && effect.stock.delta !== 0) {
    const delta = effect.stock.delta * flip;
    const units = signed(delta, `${Math.abs(delta)} ${effect.stock.product}`);
    lines.push(delta > 0 ? t.undo.stockIn(units) : t.undo.stockOut(units));
  }
  if (effect.money && effect.money.amount !== 0) {
    const amount = effect.money.amount * flip;
    const day = formatDateWith(new Date(effect.money.day), { weekday: 'long', day: 'numeric', month: 'long' });
    lines.push(t.undo.money(signed(amount, formatMoney(Math.abs(amount))), day));
  }
  for (const change of effect.fields ?? []) {
    const name = t.undo.fields[change.field as FieldName] ?? change.field;
    const [from, to] = mode === 'undo' ? [change.from, change.to] : [change.to, change.from];
    lines.push(
      MONEY_FIELDS.has(change.field) || PLAIN_FIELDS.has(change.field) || change.field === 'isActive'
        ? t.undo.fieldChange(mode, name, valueText(t, change.field, from), valueText(t, change.field, to))
        : t.undo.fieldBack(mode, name),
    );
  }
  return lines;
}
