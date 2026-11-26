import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { formatDateWith } from '../../utils/format';
import { DateField, isoToDayMonthYear } from './DateField';
import { Popover } from './Popover';
import { addDays, dayPlace, monthWeeks, pickDay } from './rangeCalendar';

interface DateRangePickerProps {
  /** "2026-11-01", or '' while not picked. */
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  min?: string;
  max?: string;
  /** A filter that may have no dates: the key says this when none are picked, and the panel can clear them. */
  anyLabel?: string;
}

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * Two dates on one calendar: a key that says the range ("01/11/2026 – 15/11/2026")
 * opens a month; click the first day, then the last, and the days between fill in
 * (hovering shows where it would end). Arrow keys walk the days, Enter picks. The
 * two dates can also be typed under the calendar. The page gets the range once
 * both ends are picked.
 */
export function DateRangePicker({ from, to, onChange, min, max, anyLabel }: DateRangePickerProps) {
  const t = useT();
  const summary =
    from && to
      ? `${isoToDayMonthYear(from)} – ${isoToDayMonthYear(to)}`
      : from
        ? `${t.periods.from} ${isoToDayMonthYear(from)}`
        : to
          ? `${t.periods.to} ${isoToDayMonthYear(to)}`
          : (anyLabel ?? t.periods.pickDates);
  return (
    <Popover label={summary} variant="secondary">
      {(close) => (
        <RangePanel
          from={from}
          to={to}
          min={min}
          max={max}
          onPicked={(range) => {
            onChange(range);
            close();
          }}
          onTyped={onChange}
          onClear={
            anyLabel && (from || to)
              ? () => {
                  onChange({ from: '', to: '' });
                  close();
                }
              : undefined
          }
        />
      )}
    </Popover>
  );
}

function RangePanel({
  from,
  to,
  min,
  max,
  onPicked,
  onTyped,
  onClear,
}: {
  from: string;
  to: string;
  min?: string;
  max?: string;
  onPicked: (range: { from: string; to: string }) => void;
  onTyped: (range: { from: string; to: string }) => void;
  onClear?: () => void;
}) {
  const t = useT();
  // The range being picked here; the page only hears about it once both ends are in.
  const [draft, setDraft] = useState({ from, to });
  const [hover, setHover] = useState('');
  const start = from || todayIso();
  const [month, setMonth] = useState(() => ({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 }));
  const [focused, setFocused] = useState(start);
  const grid = useRef<HTMLDivElement>(null);

  const weeks = monthWeeks(month.year, month.month);
  // Written by 4VD's own formatter: many browsers have no Albanian month names.
  const title = formatDateWith(new Date(Date.UTC(month.year, month.month, 1)), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const weekdays = t.periods.weekdaysShort;
  const longDay = (day: string) =>
    formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const outside = (day: string) => (min !== undefined && day < min) || (max !== undefined && day > max);
  const shiftMonth = (by: number) =>
    setMonth(({ year, month: current }) => {
      const date = new Date(Date.UTC(year, current + by, 1));
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
    });

  const pick = (day: string) => {
    if (outside(day)) return;
    const next = pickDay(draft, day);
    setDraft({ from: next.from, to: next.to });
    if (next.done) onPicked({ from: next.from, to: next.to });
  };

  // Arrow keys walk the days (a week up or down), turning the month when they leave it.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = addDays(focused, step);
    setFocused(next);
    if (draft.from && !draft.to) setHover(next);
    const nextMonth = { year: Number(next.slice(0, 4)), month: Number(next.slice(5, 7)) - 1 };
    if (nextMonth.year !== month.year || nextMonth.month !== month.month) setMonth(nextMonth);
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());
  }

  const shownEnd = draft.to || hover;
  // Exactly one day takes Tab: the focused one when it is in this month, else the 1st.
  const tabDay = weeks.flat().includes(focused) ? focused : weeks.flat().find(Boolean)!;

  return (
    <div className="range-picker">
      <div className="range-picker__head">
        <button type="button" className="range-picker__turn" aria-label={t.kit.previousMonth} onClick={() => shiftMonth(-1)}>
          <CaretLeft size={16} weight="bold" aria-hidden="true" />
        </button>
        <span className="range-picker__month" aria-live="polite">
          {title}
        </span>
        <button type="button" className="range-picker__turn" aria-label={t.kit.nextMonth} onClick={() => shiftMonth(1)}>
          <CaretRight size={16} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <p className="range-picker__hint">{draft.from && !draft.to ? t.periods.pickEnd : t.periods.pickStart}</p>
      <div ref={grid} className="range-picker__grid" role="grid" aria-label={title} onKeyDown={onKeyDown} onPointerLeave={() => setHover('')}>
        <div role="row" className="range-picker__week">
          {weekdays.map((name) => (
            <span key={name} role="columnheader" className="range-picker__weekday">
              {name}
            </span>
          ))}
        </div>
        {weeks.map((week, row) => (
          <div key={row} role="row" className="range-picker__week">
            {week.map((day, column) =>
              day === null ? (
                <span key={column} role="gridcell" className="range-picker__blank" />
              ) : (
                <span key={day} role="gridcell" aria-selected={dayPlace(day, draft.from, draft.to) !== null}>
                  <button
                    type="button"
                    data-day={day}
                    data-place={dayPlace(day, draft.from, shownEnd) ?? undefined}
                    data-today={day === todayIso() || undefined}
                    className="range-picker__day"
                    tabIndex={day === tabDay ? 0 : -1}
                    disabled={outside(day)}
                    aria-label={longDay(day)}
                    onClick={() => pick(day)}
                    onPointerEnter={() => draft.from && !draft.to && setHover(day)}
                    onFocus={() => setFocused(day)}
                  >
                    {Number(day.slice(8))}
                  </button>
                </span>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="range-picker__typed">
        <label className="inline-field">
          {t.periods.from}
          <DateField
            value={draft.from}
            min={min}
            max={draft.to || max}
            onChange={(value) => {
              setDraft((range) => ({ ...range, from: value }));
              if (value && draft.to) onTyped({ from: value, to: draft.to });
            }}
          />
        </label>
        <label className="inline-field">
          {t.periods.to}
          <DateField
            value={draft.to}
            min={draft.from || min}
            max={max}
            onChange={(value) => {
              setDraft((range) => ({ ...range, to: value }));
              if (value && draft.from) onTyped({ from: draft.from, to: value });
            }}
          />
        </label>
      </div>
      {onClear && (
        <button type="button" className="multi-select__clear" onClick={onClear}>
          {t.periods.clearDates}
        </button>
      )}
    </div>
  );
}
