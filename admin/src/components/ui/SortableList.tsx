import { DotsSixVertical } from '@phosphor-icons/react';
import { type Key, type KeyboardEvent, type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { motionLevel } from '../../theme/motion';
import { dropIndex, moveItem } from './sortableMath';

interface SortableListProps<Item> {
  items: Item[];
  itemKey: (item: Item) => Key;
  /** The item's name, for the grip's label and what a screen reader hears after a move. */
  itemName: (item: Item) => string;
  onReorder: (next: Item[]) => void;
  /** One row's content; the grip is drawn first on its own. */
  renderItem: (item: Item, index: number) => ReactNode;
  className?: string;
  itemClassName?: string;
}

interface Drag {
  pointer: number;
  from: number;
  to: number;
  startY: number;
  dy: number;
  rows: HTMLElement[];
  middles: number[];
  /** How far the others step aside: the dragged row's height and the gap under it. */
  step: number;
}

/**
 * A list put in order by hand (DESIGN.md 12): drag a row by its grip with a mouse
 * or a finger, and the others make room on the spring; let go and it settles into
 * its place. On the keyboard the grip is a key: the up and down arrows move the row
 * one place, and a screen reader hears where it went. Under Reduced or Off motion
 * the rows jump straight to their places.
 */
export function SortableList<Item>({ items, itemKey, itemName, onReorder, renderItem, className, itemClassName }: SortableListProps<Item>) {
  const t = useT();
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<Key | null>(null);
  const [said, setSaid] = useState('');
  // After a drop: the row's place on screen when it was let go, so it can settle from there.
  const settle = useRef<{ key: Key; top: number } | null>(null);
  // After an arrow key: keep the moved row's grip focused once the list has been redrawn.
  const refocus = useRef<Key | null>(null);

  const rowsNow = () => Array.from(list.current?.children ?? []) as HTMLElement[];
  const moves = () => motionLevel() === 'full';

  useLayoutEffect(() => {
    const rows = rowsNow();
    const landed = settle.current;
    settle.current = null;
    // The rows that stepped aside are now really in those places: drop their offsets without a glide.
    for (const row of rows) {
      row.style.transition = 'none';
      row.style.removeProperty('transform');
    }
    const row = landed && moves() ? rows.find((one) => one.dataset.key === String(landed.key)) : undefined;
    // FLIP: the dropped row starts where it was let go, then glides the last bit into its place.
    if (row && landed) row.style.transform = `translateY(${landed.top - row.getBoundingClientRect().top}px)`;
    void list.current?.offsetHeight;
    for (const one of rows) one.style.removeProperty('transition');
    row?.style.removeProperty('transform');
    if (refocus.current !== null) {
      const key = String(refocus.current);
      refocus.current = null;
      rowsNow()
        .find((row) => row.dataset.key === key)
        ?.querySelector<HTMLElement>('.sortable__grip')
        ?.focus();
    }
  }, [items]);

  const announce = (item: Item, place: number) => setSaid(t.kit.movedTo(itemName(item), place, items.length));

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (event.button !== 0 || items.length < 2) return;
    event.preventDefault();
    const rows = rowsNow();
    const boxes = rows.map((row) => row.getBoundingClientRect());
    const mine = boxes[index]!;
    const next = boxes[index + 1];
    const previous = boxes[index - 1];
    // One row's pitch: its height plus any gap, measured to its neighbour.
    const pitch = next ? next.top - mine.top : previous ? mine.top - previous.top : mine.height;
    drag.current = {
      pointer: event.pointerId,
      from: index,
      to: index,
      startY: event.clientY,
      dy: 0,
      rows,
      middles: boxes.map((box) => box.top + box.height / 2),
      step: pitch,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(itemKey(items[index]!));
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const now = drag.current;
    if (!now || event.pointerId !== now.pointer) return;
    now.dy = event.clientY - now.startY;
    now.to = dropIndex(now.middles, now.from, now.middles[now.from]! + now.dy);
    now.rows.forEach((row, index) => {
      if (index === now.from) {
        row.style.transform = `translateY(${now.dy}px)`;
        return;
      }
      const shift = index > now.from && index <= now.to ? -now.step : index < now.from && index >= now.to ? now.step : 0;
      row.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const now = drag.current;
    if (!now || event.pointerId !== now.pointer) return;
    drag.current = null;
    setDragging(null);
    const item = items[now.from]!;
    if (now.to === now.from || event.type === 'pointercancel') {
      // Back to where it was.
      for (const row of now.rows) row.style.removeProperty('transform');
      return;
    }
    settle.current = { key: itemKey(item), top: now.rows[now.from]!.getBoundingClientRect().top };
    onReorder(moveItem(items, now.from, now.to));
    announce(item, now.to + 1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const to = index + by;
    if (!by || to < 0 || to >= items.length) return;
    event.preventDefault();
    const item = items[index]!;
    refocus.current = itemKey(item);
    onReorder(moveItem(items, index, to));
    announce(item, to + 1);
  }

  return (
    <>
      <ol ref={list} className={['sortable', className].filter(Boolean).join(' ')} data-dragging={dragging !== null || undefined}>
        {items.map((item, index) => {
          const key = itemKey(item);
          const name = itemName(item);
          return (
            <li key={key} data-key={String(key)} className={['sortable__item', itemClassName].filter(Boolean).join(' ')} data-lifted={dragging === key || undefined}>
              <button
                type="button"
                className="sortable__grip"
                aria-label={t.kit.moveHandle(name)}
                title={t.kit.moveHandle(name)}
                onPointerDown={(event) => onPointerDown(event, index)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <DotsSixVertical size={16} weight="bold" aria-hidden="true" />
              </button>
              {renderItem(item, index)}
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" aria-live="assertive">
        {said}
      </p>
    </>
  );
}
