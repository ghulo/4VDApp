import { COMPARE_KEYS, type CompareKey, PERIOD_KEYS, type PeriodKey } from '../utils/periods';
import { useT } from '../i18n/useT';

interface PeriodPickerProps {
  period: PeriodKey;
  from: string;
  to: string;
  onChange: (next: { period: PeriodKey; from: string; to: string }) => void;
  /** Shows a "Compare with" choice next to the period, for pages with comparisons. */
  compare?: { value: CompareKey; onChange: (next: CompareKey) => void };
}

export function PeriodPicker({ period, from, to, onChange, compare }: PeriodPickerProps) {
  const t = useT();
  return (
    <div className="toolbar">
      <select
        aria-label={t.periods.label}
        value={period}
        onChange={(event) => onChange({ period: event.target.value as PeriodKey, from, to })}
      >
        {PERIOD_KEYS.map((key) => (
          <option key={key} value={key}>
            {t.periods.options[key]}
          </option>
        ))}
      </select>
      {compare && (
        <select aria-label={t.periods.compareWith} value={compare.value} onChange={(event) => compare.onChange(event.target.value as CompareKey)}>
          {COMPARE_KEYS.map((key) => (
            <option key={key} value={key}>
              {t.periods.compareShort[key]}
            </option>
          ))}
        </select>
      )}
      {period === 'custom' && (
        <>
          <label className="inline-field">
            {t.periods.from}
            <input type="date" value={from} max={to || undefined} onChange={(event) => onChange({ period, from: event.target.value, to })} />
          </label>
          <label className="inline-field">
            {t.periods.to}
            <input type="date" value={to} min={from || undefined} onChange={(event) => onChange({ period, from, to: event.target.value })} />
          </label>
        </>
      )}
    </div>
  );
}
