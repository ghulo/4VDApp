import { CalendarBlank } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';

/** "2026-10-13" as "13/10/2026": day, month, year in both languages (DESIGN.md 10.6). */
export function isoToDayMonthYear(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
}

/**
 * What someone typed as "13/10/2026" (also 13.10.2026, 13-10-26 or 1/2/2026),
 * as "2026-10-13"; null when it isn't a real day.
 */
export function dayMonthYearToIso(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/);
  if (!match) return null;
  const [, day, month, shortYear] = match as unknown as [string, string, string, string];
  const year = shortYear.length === 2 ? 2000 + Number(shortYear) : Number(shortYear);
  const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date.toISOString().slice(0, 10);
}

interface DateFieldProps {
  /** "2026-10-13", or '' for none. */
  value: string;
  /** Called with "2026-10-13" once the text is a whole day, '' while it isn't. */
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

/**
 * A date written day/month/year in every language, whatever the browser's own
 * date box would show, with the calendar a tap away on the button at its end.
 * Wrap it in a Field (or a label) like any input: the text box gets the label.
 */
export function DateField({ value, onChange, min, max, required, disabled, 'aria-label': ariaLabel }: DateFieldProps) {
  const t = useT();
  const [draft, setDraft] = useState(() => isoToDayMonthYear(value));
  const text = useRef<HTMLInputElement>(null);
  const calendar = useRef<HTMLInputElement>(null);

  // A new value from outside (the calendar, a quick-pick button) replaces the
  // text, but half-typed text that doesn't make a day yet is left alone.
  useEffect(() => {
    if ((dayMonthYearToIso(draft) ?? '') !== value) setDraft(isoToDayMonthYear(value));
  }, [value]);

  const iso = dayMonthYearToIso(draft);
  const problem =
    draft.trim() === '' ? '' : !iso ? t.common.badDate : min && iso < min ? t.common.notBefore(isoToDayMonthYear(min)) : max && iso > max ? t.common.notAfter(isoToDayMonthYear(max)) : '';
  // The form won't send while the text isn't a day in range, and says why.
  useEffect(() => text.current?.setCustomValidity(problem), [problem]);

  const openCalendar = () => {
    const input = calendar.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  };

  return (
    <span className="date-field">
      <input
        ref={text}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={t.common.dateFormat}
        value={draft}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={problem ? true : undefined}
        title={problem || undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(dayMonthYearToIso(event.target.value) ?? '');
        }}
      />
      <button type="button" className="date-field__calendar" aria-label={t.common.pickDate} title={t.common.pickDate} disabled={disabled} onClick={openCalendar}>
        <CalendarBlank size={18} aria-hidden="true" />
      </button>
      <input
        ref={calendar}
        type="date"
        className="date-field__native"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}
