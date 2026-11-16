import { ArrowRight } from '@phosphor-icons/react';
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { MenuButton } from './MenuButton';

export interface BoardColumn {
  key: string;
  title: string;
}

export interface BoardCard {
  key: string;
  column: string;
  /** Names the card for screen readers and the move menu. */
  title: string;
  content: ReactNode;
}

interface BoardProps {
  label: string;
  columns: BoardColumn[];
  cards: BoardCard[];
  /** A card was moved to another column; the page saves it and passes the new cards back. */
  onMove: (card: string, column: string) => void;
  /** Words in a column with no cards. */
  emptyText?: string;
}

/**
 * Work that moves through stages (deliveries: To take, On the way, Delivered),
 * as columns of cards. On a computer a card can be dragged to another column;
 * everywhere, its "Move to" key does the same, so a phone or a keyboard can
 * too. On a phone the columns sit side by side and scroll sideways a column at a time.
 */
export function Board({ label, columns, cards, onMove, emptyText }: BoardProps) {
  const t = useT();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // The card that just moved settles into its new column; the rest show at once.
  const [arrived, setArrived] = useState<string | null>(null);
  // A card moved from its Move key is rebuilt in the new column, so keyboard focus follows it there.
  const refocus = useRef<string | null>(null);
  const move = (card: string, column: string) => {
    setArrived(card);
    onMove(card, column);
  };
  useEffect(() => {
    const key = refocus.current;
    if (key === null) return;
    refocus.current = null;
    document.querySelector<HTMLButtonElement>(`[data-card="${CSS.escape(key)}"] .menu-button > button`)?.focus();
  }, [cards]);

  const drop = (event: DragEvent, column: string) => {
    event.preventDefault();
    const card = event.dataTransfer.getData('text/plain') || dragging;
    const current = cards.find((item) => item.key === card);
    if (current && current.column !== column) move(current.key, column);
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="kanban" role="region" aria-label={label}>
      {columns.map((column) => {
        const inColumn = cards.filter((card) => card.column === column.key);
        const headingId = `kanban-${column.key}`;
        return (
          <section
            key={column.key}
            className={over === column.key && cards.find((card) => card.key === dragging)?.column !== column.key ? 'kanban__column kanban__column--over' : 'kanban__column'}
            aria-labelledby={headingId}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              setOver(column.key);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(event) => drop(event, column.key)}
          >
            <h3 id={headingId} className="kanban__heading">
              {column.title}
              <span className="kanban__count">{inColumn.length}</span>
            </h3>
            {inColumn.length === 0 ? (
              <p className="kanban__empty">{emptyText ?? t.kit.nothingHere}</p>
            ) : (
              <ul className="kanban__cards">
                {inColumn.map((card) => (
                  <li
                    key={card.key}
                    data-card={card.key}
                    className={['kanban__card', dragging === card.key && 'kanban__card--lifted', arrived === card.key && 'kanban__card--arrived'].filter(Boolean).join(' ')}
                    onAnimationEnd={(event) => {
                      if (event.target === event.currentTarget) setArrived((was) => (was === card.key ? null : was));
                    }}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', card.key);
                      event.dataTransfer.effectAllowed = 'move';
                      setDragging(card.key);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  >
                    <div className="kanban__content">{card.content}</div>
                    <MenuButton
                      label={t.kit.moveTo}
                      icon={ArrowRight}
                      items={columns
                        .filter((other) => other.key !== column.key)
                        .map((other) => ({
                          label: other.title,
                          onSelect: () => {
                            refocus.current = card.key;
                            move(card.key, other.key);
                          },
                        }))}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
