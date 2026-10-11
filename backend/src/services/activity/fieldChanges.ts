export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isChange = (value: unknown): value is { from: unknown; to: unknown } => isRecord(value) && 'from' in value && 'to' in value;

/**
 * The fields one activity entry changed, before and after, whichever way it
 * was logged: `{ field: { from, to } }` (products, people, settings), a
 * `fields` list (the shop), `before`/`after` records (suppliers, customers),
 * or a bare `{ from, to }` (bulk prices; barcodes before they were keyed).
 * Markers such as `undoOf` and `restoredTo` are not fields.
 */
export function fieldChangesOf(entry: { action: string; details: Record<string, unknown> | null }): FieldChange[] {
  const details = entry.details;
  if (!details) return [];
  if (Array.isArray(details.fields)) {
    return details.fields.filter((change): change is FieldChange => isRecord(change) && typeof change.field === 'string');
  }
  if (isRecord(details.before) && isRecord(details.after)) {
    const before = details.before;
    return Object.entries(details.after)
      .filter(([field, to]) => JSON.stringify(before[field] ?? null) !== JSON.stringify(to ?? null))
      .map(([field, to]) => ({ field, from: before[field] ?? null, to: to ?? null }));
  }
  if (isChange(details)) {
    const field = entry.action === 'pricing.updated' ? 'bulkPricingTiers' : entry.action === 'product.barcode_set' ? 'barcode' : null;
    return field ? [{ field, from: details.from, to: details.to }] : [];
  }
  return Object.entries(details).flatMap(([field, change]) => (isChange(change) ? [{ field, from: change.from, to: change.to }] : []));
}
