import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { formatDateWith } from '../../utils/format';
import { Button } from './Button';

export interface CalendarEvent {
  key: string | number;
  /** The day, "2026-10-21". */
  date: string;
  label: string;
  /** Late or a problem: drawn in the danger colour. */
  late?: boolean;
}

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Moves a "2026-10-21" day by some days, at noon so clock changes never skip one. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return iso(date);
}

/** The same day in another month, kept inside it (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const first = new Date(year, month - 1 + months, 1, 12);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return iso(new Date(first.getFullYear(), first.getMonth(), Math.min(date, last), 12));
}

/** The six Monday-first weeks shown for the month that holds `day`. */
export function monthGrid(day: string): string[][] {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const first = new Date(year, month - 1, 1, 12);
  const back = (first.getDay() + 6) % 7;
  const start = addDays(iso(first), -back);
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, weekday) => addDays(start, week * 7 + weekday)));
}

interface CalendarProps {
  label: string;
  /** The chosen day; the month around it is shown. */
  selected: string;
  onSelect: (day: string) => void;
  events?: CalendarEvent[];
  /** Today, "2026-10-21"; defaults to the computer's date. */
  today?: string;
}

/**
 * A month of days with what is planned on each (deliveries, collections),
 * Monday first. The arrow keys move a day or a week, Page Up and Page Down a
 * month, Home and End to the week's ends; Enter picks. Each day says how
 * many things are on it; on a phone they become dots.
 */
export function Calendar({ label, selected, onSelect, events = [], today: givenToday }: CalendarProps) {
  const [computerToday] = useState(() => iso(new Date()));
  const today = givenToday ?? computerToday;
  const t = useT();
  const gridRef = useRef<HTMLTableElement>(null);
  const focusAfterMove = useRef(false);
  const weeks = monthGrid(selected);
  const month = selected.slice(0, 7);
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);
  const title = formatDateWith(new Date(`${selected}T12:00:00`), { month: 'long', year: 'numeric' });

  useEffect(() => {
    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [selected]);

  const move = (day: string) => {
    focusAfterMove.current = true;
    onSelect(day);
  };

  function onKeyDown(event: KeyboardEvent) {
    const weekday = (new Date(`${selected}T12:00:00`).getDay() + 6) % 7;
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(selected, -1),
      ArrowRight: () => addDays(selected, 1),
      ArrowUp: () => addDays(selected, -7),
      ArrowDown: () => addDays(selected, 7),
      Home: () => addDays(selected, -weekday),
      End: () => addDays(selected, 6 - weekday),
      PageUp: () => addMonths(selected, -1),
      PageDown: () => addMonths(selected, 1),
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    move(next());
  }

  return (
    <div className="calendar">
      <div className="calendar__head">
        <h3 className="calendar__title" aria-live="polite">
          {title}
        </h3>
        <div className="calendar__nav">
          <Button size="sm" onClick={() => onSelect(today)}>
            {t.kit.today}
          </Button>
          <Button size="sm" variant="ghost" icon={CaretLeft} aria-label={t.kit.previousMonth} onClick={() => onSelect(addMonths(selected, -1))} />
          <Button size="sm" variant="ghost" icon={CaretRight} aria-label={t.kit.nextMonth} onClick={() => onSelect(addMonths(selected, 1))} />
        </div>
      </div>
      <table ref={gridRef} className="calendar__grid" role="grid" aria-label={`${label}, ${title}`} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {t.analysis.weekdayShort.map((day, index) => (
              <th key={day} scope="col" abbr={t.analysis.weekdayLong[index]}>
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const items = byDay.get(day) ?? [];
                const classes = [
                  'calendar__day',
                  day.slice(0, 7) !== month && 'calendar__day--outside',
                  day === today && 'calendar__day--today',
                  day === selected && 'calendar__day--selected',
                ]
                  .filter(Boolean)
                  .join(' ');
                const date = new Date(`${day}T12:00:00`);
                return (
                  <td key={day} role="gridcell" aria-selected={day === selected}>
                    <button
                      type="button"
                      className={classes}
                      tabIndex={day === selected ? 0 : -1}
                      aria-current={day === today ? 'date' : undefined}
                      onClick={() => move(day)}
                    >
                      {/* Read out as "Wednesday 21 October", then what is planned. */}
                      <span className="visually-hidden">{formatDateWith(date, { weekday: 'long' })} </span>
                      <span className="calendar__number">{Number(day.slice(8))}</span>
                      <span className="visually-hidden"> {formatDateWith(date, { month: 'long' })}</span>
                      {items.length > 0 && (
                        <span className="calendar__items">
                          {items.slice(0, 2).map((item) => (
                            <span key={item.key} className={item.late ? 'calendar__item calendar__item--late' : 'calendar__item'}>
                              {item.label}
                            </span>
                          ))}
                          {items.length > 2 && <span className="calendar__more">{t.kit.more(items.length - 2)}</span>}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
