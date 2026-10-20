import {
  ArrowCounterClockwise,
  Barcode,
  CaretDown,
  Coins,
  Calculator,
  Hash,
  MagnifyingGlass,
  Percent,
  Plus,
  Printer,
  Receipt,
  SignOut,
  Tag,
  Trash,
  User,
  UserSwitch,
  WifiHigh,
} from '@phosphor-icons/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { LogoMark } from '../components/LogoMark';
import { Button, MenuButton } from '../components/ui';
import { formatMoney } from '../utils/format';

/**
 * A look-only test of the Counter as a till roll (/counter-preview): the
 * basket is the receipt being printed. Sample products only; nothing is sold,
 * printed or saved. Remove once the real Counter is decided.
 */

interface SampleProduct {
  code: string;
  name: string;
  price: number;
  vat: 18 | 8;
}

const SAMPLES: SampleProduct[] = [
  { code: '3902379930018', name: 'Ceramic Vase', price: 35, vat: 18 },
  { code: '3900000000412', name: 'Oak Dining Chair', price: 89, vat: 18 },
  { code: '3901234500017', name: 'Lëng molle Bravo 1L', price: 0.85, vat: 8 },
  { code: '3900000000610', name: 'Brass Floor Lamp', price: 159, vat: 18 },
  { code: '3909876500023', name: 'Bukë e bardhë 500g', price: 0.6, vat: 8 },
];

interface Line {
  id: number;
  product: SampleProduct;
  qty: number;
  rabat: number;
}

const START: Line[] = [
  { id: 1, product: SAMPLES[0]!, qty: 2, rabat: 0 },
  { id: 2, product: SAMPLES[1]!, qty: 1, rabat: 10 },
  { id: 3, product: SAMPLES[2]!, qty: 6, rabat: 0 },
];

const lineTotal = (line: Line) => Math.round(line.product.price * line.qty * (1 - line.rabat / 100) * 100) / 100;
/** Prices include VAT, so the VAT inside a total is total × rate / (100 + rate). */
const vatIn = (total: number, rate: number) => Math.round(((total * rate) / (100 + rate)) * 100) / 100;

export function CounterPreviewPage() {
  const [lines, setLines] = useState<Line[]>(START);
  const [selected, setSelected] = useState<number | null>(2);
  const [fresh, setFresh] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const nextId = useRef(4);
  const scanRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const pieces = lines.reduce((sum, line) => sum + line.qty, 0);
  const rates = [18, 8].map((rate) => ({ rate, amount: vatIn(lines.filter((line) => line.product.vat === rate).reduce((sum, line) => sum + lineTotal(line), 0), rate) }));
  const picked = lines.find((line) => line.id === selected) ?? null;

  function scan(event: FormEvent) {
    event.preventDefault();
    const typed = query.trim().toLowerCase();
    const product = typed ? SAMPLES.find((sample) => sample.name.toLowerCase().includes(typed) || sample.code === typed) : SAMPLES[(nextId.current - 1) % SAMPLES.length];
    if (!product) return;
    const id = nextId.current++;
    setLines((now) => [...now, { id, product, qty: 1, rabat: 0 }]);
    setSelected(id);
    setFresh(id);
    setQuery('');
  }

  const change = (patch: Partial<Line>) => picked && setLines((now) => now.map((line) => (line.id === picked.id ? { ...line, ...patch } : line)));

  return (
    <div className="cp">
      <header className="cp-bar">
        <div className="cp-bar__brand">
          <LogoMark size={28} />
          <div>
            <h1 className="cp-bar__title">Counter</h1>
            <p className="cp-bar__who">Selling as Demo Admin · test layout, nothing is saved</p>
          </div>
        </div>
        <div className="cp-bar__status">
          <span className="cp-chip cp-chip--ok">
            <WifiHigh size={14} weight="bold" aria-hidden="true" />
            Online
          </span>
          <span className="cp-chip">
            <Printer size={14} aria-hidden="true" />
            Printing is off
          </span>
          <Button variant="ghost" size="sm" icon={UserSwitch}>
            Switch person
          </Button>
          <Link to="/counter" className="cp-bar__back">
            <SignOut size={14} aria-hidden="true" />
            Real Counter
          </Link>
        </div>
      </header>

      <main className="cp-main">
        <section className="cp-roll-side" aria-label="Sale">
          <div className="cp-scan-row">
            <form className="cp-scan" onSubmit={scan}>
              <Barcode size={20} aria-hidden="true" />
              <input
                ref={scanRef}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Scan or type a product… (Enter adds a sample)"
                aria-label="Scan or type a product"
              />
            </form>
            <div className="cp-baskets" role="group" aria-label="Baskets">
              <button type="button" className="cp-basket" aria-pressed="true">
                Basket 1
              </button>
              <button type="button" className="cp-basket" aria-pressed="false">
                Basket 2 <span className="cp-basket__sum">€12.40</span>
              </button>
              <Button variant="ghost" size="sm" icon={Plus} title="F8">
                New
              </Button>
            </div>
          </div>

          <div className="cp-tray">
            <article className="cp-roll" aria-label="Receipt">
              <header className="cp-roll__head">
                <button type="button" className="cp-roll__customer">
                  <User size={14} aria-hidden="true" />
                  Walk-in customer
                  <kbd>F5</kbd>
                </button>
                <p className="cp-roll__meta">
                  <span>F-2026-000011</span>
                  <span>{lines.length > 0 ? 'Started 13:02' : 'Ready to scan'}</span>
                </p>
              </header>

              {lines.length === 0 ? (
                <p className="cp-roll__empty">
                  <Barcode size={28} aria-hidden="true" />
                  Scan the first product
                </p>
              ) : (
                <ol className="cp-roll__lines">
                  {lines.map((line) => (
                    <li key={line.id} className={line.id === fresh ? 'cp-line cp-line--fresh' : 'cp-line'}>
                      <button type="button" className="cp-line__button" aria-pressed={line.id === selected} onClick={() => setSelected(line.id === selected ? null : line.id)}>
                        <span className="cp-line__name">{line.product.name}</span>
                        <span className="cp-line__sum">{formatMoney(lineTotal(line))}</span>
                        <span className="cp-line__how">
                          {line.qty} × {formatMoney(line.product.price)}
                          <span className="cp-line__vat">{line.product.vat}%</span>
                        </span>
                        {line.rabat > 0 && (
                          <span className="cp-line__rabat">
                            Rabat {line.rabat}%<span>−{formatMoney(line.product.price * line.qty * (line.rabat / 100))}</span>
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              <footer className="cp-roll__foot">
                <dl className="cp-roll__facts">
                  <div>
                    <dt>Products</dt>
                    <dd>{lines.length}</dd>
                  </div>
                  <div>
                    <dt>Pieces</dt>
                    <dd>{pieces}</dd>
                  </div>
                  {rates
                    .filter((rate) => rate.amount > 0)
                    .map((rate) => (
                      <div key={rate.rate}>
                        <dt>VAT {rate.rate}%</dt>
                        <dd>{formatMoney(rate.amount)}</dd>
                      </div>
                    ))}
                </dl>
                <p className="cp-roll__total">
                  <span>To pay</span>
                  <strong>{formatMoney(total)}</strong>
                </p>
              </footer>
            </article>
          </div>
        </section>

        <aside className="cp-keys" aria-label="Keys">
          <button type="button" className="cp-pay" disabled={lines.length === 0}>
            <span className="cp-pay__word">
              Pay <kbd>F9</kbd>
            </span>
            <span className="cp-pay__how">Cash · Card · Tab</span>
          </button>

          {picked ? (
            <section className="cp-group" aria-label="Selected line">
              <h2 className="cp-group__title">
                Selected line: <strong>{picked.product.name}</strong>
              </h2>
              <div className="cp-group__keys">
                <Button className="cp-key" icon={Hash} onClick={() => change({ qty: picked.qty + 1 })}>
                  Quantity <kbd>F2</kbd>
                </Button>
                <Button className="cp-key" icon={Tag}>
                  Price <kbd>F6</kbd>
                </Button>
                <Button className="cp-key" icon={Percent} onClick={() => change({ rabat: picked.rabat === 0 ? 5 : 0 })}>
                  Rabat <kbd>F4</kbd>
                </Button>
                <Button
                  className="cp-key"
                  icon={Trash}
                  onClick={() => {
                    setLines((now) => now.filter((line) => line.id !== picked.id));
                    setSelected(null);
                  }}
                >
                  Remove <kbd>Del</kbd>
                </Button>
              </div>
            </section>
          ) : (
            <p className="cp-hint">Pick a line on the receipt to change its quantity, price or rabat.</p>
          )}

          <section className="cp-group" aria-label="This sale">
            <h2 className="cp-group__title">This sale</h2>
            <div className="cp-group__keys">
              <Button className="cp-key" icon={MagnifyingGlass}>
                Search <kbd>F3</kbd>
              </Button>
              <Button className="cp-key" icon={User}>
                Customer <kbd>F5</kbd>
              </Button>
              <Button className="cp-key" icon={Tag}>
                Price check <kbd>F10</kbd>
              </Button>
              <Button className="cp-key" icon={Percent}>
                Basket rabat
              </Button>
              <Button className="cp-key" icon={ArrowCounterClockwise}>
                Refund <kbd>F7</kbd>
              </Button>
              <Button className="cp-key" icon={Receipt}>
                Invoices <kbd>F1</kbd>
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="cp-cancel" onClick={() => setLines([])}>
              Cancel basket
            </Button>
          </section>

          <section className="cp-day" aria-label="My day">
            <div>
              <p className="cp-day__label">My day</p>
              <p className="cp-day__sum">
                {formatMoney(1403)} <span>4 receipts</span>
              </p>
            </div>
            <MenuButton
              label="Till"
              icon={CaretDown}
              variant="secondary"
              items={[
                { label: 'X report', icon: Printer, onSelect: () => undefined },
                { label: 'Z report', icon: Printer, onSelect: () => undefined },
                { label: 'Opening cash', icon: Coins, onSelect: () => undefined },
                { label: 'Count the drawer', icon: Calculator, onSelect: () => undefined },
              ]}
            />
          </section>
        </aside>
      </main>

      <footer className="cp-status">
        <ul className="cp-status__keys" aria-label="Shortcuts">
          {[
            ['F1', 'Invoices'],
            ['F2', 'Qty'],
            ['F3', 'Search'],
            ['F4', 'Rabat'],
            ['F5', 'Customer'],
            ['F7', 'Refund'],
            ['F8', 'New basket'],
            ['F9', 'Pay'],
            ['F10', 'Price check'],
          ].map(([key, what]) => (
            <li key={key}>
              <kbd>{key}</kbd> {what}
            </li>
          ))}
        </ul>
        <time className="cp-status__clock">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
      </footer>
    </div>
  );
}
