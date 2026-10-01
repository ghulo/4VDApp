import { PERIOD_OPTIONS, type PeriodKey } from '../utils/periods';

interface PeriodPickerProps {
  period: PeriodKey;
  from: string;
  to: string;
  onChange: (next: { period: PeriodKey; from: string; to: string }) => void;
}

export function PeriodPicker({ period, from, to, onChange }: PeriodPickerProps) {
  return (
    <div className="toolbar">
      <select
        aria-label="Period"
        value={period}
        onChange={(event) => onChange({ period: event.target.value as PeriodKey, from, to })}
      >
        {PERIOD_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      {period === 'custom' && (
        <>
          <label className="inline-field">
            From
            <input type="date" value={from} max={to || undefined} onChange={(event) => onChange({ period, from: event.target.value, to })} />
          </label>
          <label className="inline-field">
            To
            <input type="date" value={to} min={from || undefined} onChange={(event) => onChange({ period, from, to: event.target.value })} />
          </label>
        </>
      )}
    </div>
  );
}
