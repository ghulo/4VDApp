import { useEffect, useState } from 'react';
import { useT } from '../i18n/useT';
import { formatMoney } from '../utils/format';
import { SCAN_EVENT } from '../utils/shopScan';

type Row =
  | { kind: 'shop' }
  | { kind: 'number'; number: number; time: string }
  | { kind: 'rule' }
  | { kind: 'item'; item: number; quantity: number; beeped: boolean }
  | { kind: 'total'; amount: number }
  | { kind: 'cash'; amount: number }
  | { kind: 'change'; amount: number }
  | { kind: 'thanks' };

type Printed = Row & { id: number };
type Item = { price: number; once?: boolean };

const random = (from: number, to: number) => from + Math.random() * (to - from);
const clock = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** A sale's products: a few different ones, at most one carwash, one to three of each grocery. */
function pickBasket(items: Item[]): Array<{ item: number; quantity: number }> {
  const order = items.map((_, index) => index).sort(() => Math.random() - 0.5);
  const basket: Array<{ item: number; quantity: number }> = [];
  let washed = false;
  for (const index of order) {
    if (basket.length >= 4 + Math.floor(Math.random() * 3)) break;
    if (items[index]!.once) {
      if (washed) continue;
      washed = true;
    }
    basket.push({ item: index, quantity: items[index]!.once ? 1 : 1 + Math.floor(Math.random() ** 2 * 3) });
  }
  return basket;
}

const totalOf = (items: Item[], basket: Array<{ item: number; quantity: number }>) =>
  Math.round(basket.reduce((sum, line) => sum + items[line.item]!.price * line.quantity, 0) * 100) / 100;

/** The note the customer hands over: the next 5, 10, 20 or 50 above the total. */
const noteFor = (total: number) => [5, 10, 20, 50, 100].find((note) => note >= total) ?? Math.ceil(total / 50) * 50;

function wholeReceipt(items: Item[]): Row[] {
  const basket = pickBasket(items);
  const total = totalOf(items, basket);
  const cash = noteFor(total);
  return [
    { kind: 'shop' },
    { kind: 'number', number: 1042, time: clock(new Date()) },
    { kind: 'rule' },
    ...basket.map((line): Row => ({ kind: 'item', ...line, beeped: false })),
    { kind: 'rule' },
    { kind: 'total', amount: total },
    { kind: 'cash', amount: cash },
    { kind: 'change', amount: cash - total },
    { kind: 'thanks' },
  ];
}

/**
 * The till receipt on the sign-in page: it prints a sale line by line out of
 * the printer, totals it, takes the cash, tears off and starts the next one.
 * A barcode beeped by the drawing next to it prints its line at once. For
 * people who turn motion down it is one finished receipt, standing still.
 */
export function LoginReceipt() {
  const t = useT();
  const words = t.shell.receipt;
  const items = words.items;
  const [still] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [rows, setRows] = useState<Printed[]>(() => (still ? wholeReceipt(items).map((row, id) => ({ ...row, id })) : []));
  const [tearing, setTearing] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (still) return undefined;
    let cancelled = false;
    let nextId = 0;
    let wake: (() => void) | null = null;
    let scanned = false;
    const timers = new Set<number>();
    const onScan = () => {
      if (!wake) return;
      scanned = true;
      wake();
    };
    window.addEventListener(SCAN_EVENT, onScan);

    /** Waits; a wakeable wait also ends when the drawing beeps a barcode. */
    const wait = (ms: number, wakeable = false) =>
      new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(id);
          timers.delete(id);
          wake = null;
          resolve();
        };
        const id = window.setTimeout(done, ms);
        timers.add(id);
        if (wakeable) wake = done;
      });
    const print = (row: Row) => setRows((now) => [...now, { ...row, id: nextId++ }]);

    void (async () => {
      let number = 1040 + Math.floor(Math.random() * 160);
      await wait(600);
      while (!cancelled) {
        const basket = pickBasket(items);
        const total = totalOf(items, basket);
        const cash = noteFor(total);
        setTearing(false);
        setRows([]);
        setPrinting(true);
        for (const row of [{ kind: 'shop' }, { kind: 'number', number, time: clock(new Date()) }, { kind: 'rule' }] as Row[]) {
          print(row);
          await wait(320);
        }
        for (const line of basket) {
          scanned = false;
          await wait(random(1300, 2300), true);
          if (cancelled) return;
          print({ kind: 'item', ...line, beeped: scanned });
        }
        await wait(900);
        for (const row of [
          { kind: 'rule' },
          { kind: 'total', amount: total },
          { kind: 'cash', amount: cash },
          { kind: 'change', amount: cash - total },
          { kind: 'thanks' },
        ] as Row[]) {
          if (cancelled) return;
          print(row);
          await wait(300);
        }
        setPrinting(false);
        await wait(4200);
        setTearing(true);
        await wait(900);
        number += 1;
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener(SCAN_EVENT, onScan);
      for (const id of timers) window.clearTimeout(id);
    };
  }, [still, items]);

  return (
    <div className="till" aria-hidden="true">
      <div className="till__paper-room">
        <div className={tearing ? 'till__paper till__paper--torn' : 'till__paper'}>
          {rows.map((row) => (
            <div key={row.id} className={`till__row till__row--${row.kind}${row.kind === 'item' && row.beeped ? ' till__row--beeped' : ''}`}>
              <div className="till__ink">{rowText(row)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className={printing ? 'till__printer till__printer--busy' : 'till__printer'}>
        <span className="till__slot" />
        <span className="till__light" />
      </div>
    </div>
  );

  function rowText(row: Row) {
    switch (row.kind) {
      case 'shop':
        return (
          <>
            <strong>4VD</strong>
            <span>{words.shop}</span>
          </>
        );
      case 'number':
        return <span>{words.number(row.number, row.time)}</span>;
      case 'rule':
        return null;
      case 'item': {
        const item = items[row.item]!;
        return (
          <>
            <span className="till__name">{item.name}</span>
            <span className="till__amount">{formatMoney(item.price * row.quantity)}</span>
            {row.quantity > 1 && (
              <span className="till__each">
                {row.quantity} × {formatMoney(item.price)}
              </span>
            )}
          </>
        );
      }
      case 'total':
        return (
          <>
            <span>{words.total}</span>
            <span className="till__amount">{formatMoney(row.amount)}</span>
          </>
        );
      case 'cash':
      case 'change':
        return (
          <>
            <span>{row.kind === 'cash' ? words.cash : words.change}</span>
            <span className="till__amount">{formatMoney(row.amount)}</span>
          </>
        );
      case 'thanks':
        return <span>{words.thanks}</span>;
    }
  }
}
