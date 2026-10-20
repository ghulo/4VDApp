import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { setPopover, useFloating } from './floating';

/** How strong a cell is drawn, from 0 to 1, against the busiest cell. */
export function heatLevel(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(1, value / max);
}

/** A level's colour: an empty cell stays sunk paper, the busiest is full amber. */
const heatColour = (level: number) => `color-mix(in oklab, var(--data-heat) ${level === 0 ? 0 : Math.round(12 + level * 88)}%, var(--surface-sunk))`;

interface HeatmapProps {
  /** Read out by screen readers. */
  label: string;
  /** Down the side, e.g. the weekdays. */
  rows: string[];
  /** Across the top, e.g. the hours. Long runs show every few. */
  columns: string[];
  /** values[row][column]. */
  values: number[][];
  /** What one cell says, e.g. "Saturday 10:00–11:00: €320 in 14 sales". */
  describe: (row: number, column: number) => string;
  /** Show every nth column label (the rest stay for screen readers). */
  labelEvery?: number;
}

/**
 * Two patterns at once, like which hours of which days are busy: a grid of
 * cells, stronger amber where there is more. It is a real table, so screen
 * readers walk it cell by cell; hovering a cell shows its figure.
 */
export function Heatmap({ label, rows, columns, values, describe, labelEvery = 1 }: HeatmapProps) {
  const t = useT();
  const max = Math.max(0, ...values.flat());
  // One label for the whole grid, floated above the cell under the pointer.
  const [hover, setHover] = useState<{ row: number; column: number } | null>(null);
  const cellRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  useFloating(cellRef, tipRef, hover !== null, { side: 'top', follow: hover && `${hover.row}:${hover.column}` });
  useEffect(() => setPopover(tipRef.current, hover !== null), [hover]);
  return (
    <figure className="heatmap">
      <div className="heatmap__scroll">
        <table className="heatmap__grid" onPointerLeave={() => setHover(null)}>
          <caption className="visually-hidden">{label}</caption>
          <thead>
            <tr>
              <td />
              {columns.map((column, index) => (
                <th key={column} scope="col" className="heatmap__column">
                  <span className={index % labelEvery === 0 ? undefined : 'visually-hidden'}>{column}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row}>
                <th scope="row" className="heatmap__row">
                  {row}
                </th>
                {columns.map((column, c) => {
                  const level = heatLevel(values[r]?.[c] ?? 0, max);
                  return (
                    <td
                      key={column}
                      className="heatmap__cell"
                      onPointerEnter={(event) => {
                        cellRef.current = event.currentTarget;
                        setHover({ row: r, column: c });
                      }}
                    >
                      <span className="heatmap__fill" style={{ background: heatColour(level) }} />
                      <span className="visually-hidden">{describe(r, c)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span ref={tipRef} popover="manual" className="tooltip" aria-hidden="true">
        {hover && describe(hover.row, hover.column)}
      </span>
      <figcaption className="heatmap__key" aria-hidden="true">
        {t.kit.heatLess}
        {[0, 0.25, 0.5, 0.75, 1].map((level) => (
          <span key={level} className="heatmap__swatch" style={{ background: heatColour(level) }} />
        ))}
        {t.kit.heatMore}
      </figcaption>
    </figure>
  );
}
