import { useT } from '../i18n/useT';
import { useLocations } from '../utils/useLocations';
import { Field } from './ui';

/**
 * Which location a document uses. Shows only when the shop has more than one;
 * `value` null means the default the label names ("where goods come in" for
 * stock coming in, "where the till sells" for stock going out).
 */
export function LocationSelect({
  value,
  onChange,
  coming,
  label,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  /** Stock coming in (default: where goods are received) or going out (where the till sells). */
  coming: 'in' | 'out';
  label?: string;
}) {
  const t = useT();
  const { several, locations, selling, receiving } = useLocations();
  if (!several) return null;
  const fallback = coming === 'in' ? receiving : selling;
  return (
    <Field label={label ?? t.locations.field}>
      <select value={value ?? fallback?.id ?? ''} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
