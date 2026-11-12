import type { Icon } from '@phosphor-icons/react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Figures side by side on one panel, split by hairlines. The column count
 * follows how many figures there are and the room there is, so rows always
 * fill: never 3 + 1 with an empty corner (see .stat-grid in ui.css).
 */
export function StatGrid({ children, compact }: { children: ReactNode; /** One slim strip of figures over a ledger, instead of tall tiles. */ compact?: boolean }) {
  const tiles = Children.toArray(children);
  // Two or more tiles that only say "None low", "Nothing out" fold into one cell
  // of short lines, so the strip is about the figures that are there.
  const quiet = tiles.filter(isQuietTile);
  const fold = quiet.length >= 2;
  const figures = fold ? tiles.filter((tile) => !quiet.includes(tile as ReactElement<StatTileProps>)) : tiles;
  const cells = figures.length + (fold ? 1 : 0);
  const className = ['stat-grid', compact && 'stat-grid--compact', fold && figures.length === 0 && 'stat-grid--all-quiet'].filter(Boolean).join(' ');
  return (
    <div className="stat-grid-room">
      <div className={className} data-count={Math.min(cells, 6)}>
        {figures}
        {fold && <QuietTiles tiles={quiet} />}
      </div>
    </div>
  );
}

function isQuietTile(node: ReturnType<typeof Children.toArray>[number]): node is ReactElement<StatTileProps> {
  if (!isValidElement<StatTileProps>(node) || node.type !== StatTile) return false;
  const { tone = 'default', words, value } = node.props;
  return tone === 'default' && Boolean(words || isZero(value));
}

/** The quiet tiles as one cell: a line each, label then what it says; a tile with a page keeps its link. */
function QuietTiles({ tiles }: { tiles: Array<ReactElement<StatTileProps>> }) {
  return (
    <ul className="stat stat-quiet">
      {tiles.map((tile) => {
        const { label, words, value, to } = tile.props;
        const body = (
          <>
            <span className="stat-quiet__label">{label}</span>
            <span className="stat-quiet__words">{words || String(value)}</span>
          </>
        );
        return (
          <li key={tile.key ?? label}>
            {to ? (
              <Link to={to} className="stat-quiet__row stat-quiet__row--link">
                {body}
              </Link>
            ) : (
              <span className="stat-quiet__row">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface StatTileProps {
  label: string;
  /** The label is the name of a thing (a till, a bank account), not a spec label: body type, not monospace capitals. */
  named?: boolean;
  value: ReactNode;
  /**
   * A calm sentence in place of the figure ("None low", "Not entered yet"):
   * body text, so a zero or a missing figure never shouts (DESIGN.md 3.3).
   */
  words?: ReactNode;
  hint?: ReactNode;
  /** Kept so screens can still pass one; tiles no longer draw it (a label needs no picture). */
  icon?: Icon;
  tone?: 'default' | 'warn' | 'danger';
  /** Makes the whole tile a link to the page behind the figure. */
  to?: string;
}

/** 0, "0", "€0.00", "0,00 €": a figure that is nothing. */
const ZERO = /^[^\d]*0(?:[.,]0+)?[^\d]*$/;
const isZero = (value: ReactNode) => value === 0 || (typeof value === 'string' && ZERO.test(value.trim()));

export function StatTile({ label, value, words: givenWords, hint, tone = 'default', to, named }: StatTileProps) {
  // A zero says nothing happened: it steps back like a sentence would, instead of a big 0.
  const words = givenWords || (isZero(value) ? String(value) : undefined);
  const body = (
    <>
      <span className={named ? 'stat__label stat__label--name' : 'stat__label'}>
        {label}
      </span>
      {words ? <span className="stat__words">{words}</span> : <span className="stat__value">{value}</span>}
      {hint && <span className="stat__hint">{hint}</span>}
    </>
  );
  // A tile that only says "None low" steps back, so the real figures stand out.
  const className = words ? `stat stat--${tone} stat--quiet` : `stat stat--${tone}`;
  return to ? (
    <Link to={to} className={`${className} stat--link`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
