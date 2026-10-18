import { Badge } from './ui';
import { useT } from '../i18n/useT';
import type { RecordSource } from '../services/types';

/** The small stamp on a record brought over from TREFIN's history. */
export function TrefinTag() {
  const t = useT();
  return (
    <span title={t.fromTrefin.tagLabel}>
      <Badge>{t.fromTrefin.tag}</Badge>
    </span>
  );
}

/** Reads `?source=` from a list's address: 4VD's own records, TREFIN's, or (missing) both. */
export function sourceFrom(params: URLSearchParams): RecordSource | undefined {
  const value = params.get('source');
  return value === '4vd' || value === 'trefin' ? value : undefined;
}

/** The filter every list with TREFIN records has: both, 4VD only, TREFIN only. */
export function SourceFilter({ value, onChange }: { value: RecordSource | undefined; onChange: (next: RecordSource | undefined) => void }) {
  const t = useT();
  return (
    <select
      aria-label={t.fromTrefin.show}
      value={value ?? 'all'}
      onChange={(event) => onChange(event.target.value === 'all' ? undefined : (event.target.value as RecordSource))}
    >
      {(['all', '4vd', 'trefin'] as const).map((option) => (
        <option key={option} value={option}>
          {t.fromTrefin.sources[option]}
        </option>
      ))}
    </select>
  );
}
