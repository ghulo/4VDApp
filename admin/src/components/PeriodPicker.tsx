import type { ReactNode } from 'react';
import { COMPARE_KEYS, type CompareKey, PERIOD_KEYS, type PeriodKey } from '../utils/periods';
import { useT } from '../i18n/useT';
import { DateField } from './ui';

interface PeriodPickerProps {
  period: PeriodKey;
  from: string;
  to: string;
  onChange: (next: { period: PeriodKey; from: string; to: string }) => void;
  /** The periods offered as chips; most pages look back over months. */
  periods?: readonly PeriodKey[];
  /** Shows a "Compare with" choice next to the period, for pages with comparisons. */
  compare?: { value: CompareKey; onChange: (next: CompareKey) => void };
  /** Further filters for the same view, after the period (e.g. which carwash). */
  children?: ReactNode;
  /** A dropdown instead of a row of chips, to sit in a table's toolbar with the other filters. */
  compact?: boolean;
}

/** The period a page shows, as one row of filter chips (DESIGN.md 10.10), the same on every page. */
export function PeriodPicker({ period, from, to, onChange, periods = PERIOD_KEYS, compare, children, compact }: PeriodPickerProps) {
  const t = useT();
  return (
    <div className={compact ? 'toolbar period-picker period-picker--compact' : 'toolbar period-picker'}>
      {compact ? (
        <select aria-label={t.periods.label} value={period} onChange={(event) => onChange({ period: event.target.value as PeriodKey, from, to })}>
          {periods.map((key) => (
            <option key={key} value={key}>
              {t.periods.options[key]}
            </option>
          ))}
        </select>
      ) : (
        <div className="segmented segmented--chips" role="radiogroup" aria-label={t.periods.label}>
          {periods.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={period === key}
              className="segmented__option"
              onClick={() => onChange({ period: key, from, to })}
            >
              {t.periods.options[key]}
            </button>
          ))}
        </div>
      )}
      {compare && (
        <select aria-label={t.periods.compareWith} value={compare.value} onChange={(event) => compare.onChange(event.target.value as CompareKey)}>
          {COMPARE_KEYS.map((key) => (
            <option key={key} value={key}>
              {t.periods.compareShort[key]}
            </option>
          ))}
        </select>
      )}
      {children}
      {period === 'custom' && (
        <span className="date-range">
          <label className="inline-field">
            {t.periods.from}
            <DateField value={from} max={to || undefined} onChange={(value) => onChange({ period, from: value, to })} />
          </label>
          <label className="inline-field">
            {t.periods.to}
            <DateField value={to} min={from || undefined} onChange={(value) => onChange({ period, from, to: value })} />
          </label>
        </span>
      )}
    </div>
  );
}
