import {
  ArrowCounterClockwise,
  ArrowLeft,
  Barcode,
  CashRegister,
  CheckCircle,
  CircleNotch,
  HandCoins,
  MagnifyingGlass,
  Percent,
  Plus,
  Printer,
  SignOut,
  Tag,
  Trash,
  WarningCircle,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canOversee, counterOnly } from '../auth/roles';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { afterDiscount, parsePercent, roundMoney, unitPriceFor } from '../components/BasketForm';
import { ErrorNotice } from '../components/Feedback';
import { LogoMark } from '../components/LogoMark';
import { Button, ButtonLink } from '../components/ui';
import { useT } from '../i18n/useT';
import { counterApi, customersApi, documentsApi, productsApi, salesApi, settingsApi } from '../services/api';
import type { CounterEventInput, Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { MissingTaxGroup, clearArticlesJob, receiptJob, xReportJob, zReportJob } from '../utils/fiscalReceipt';
import { codeFromScan, documentNumberFromScan } from '../utils/scanLinks';
import { NumberSheet, PaySheet, type Payment, ReasonSheet, UnprintedSheet, ZSheet } from './counter/CounterSheets';
import { RefundSheet } from './counter/RefundSheet';
import { type StoredLine, useBaskets } from './counter/useBaskets';
import { type PrintResult, type Unprinted, useFiscalPrinter } from './counter/useFiscalPrinter';

const SHELF_PAGE = 60;

type Panel = 'quantity' | 'price' | 'discount' | 'remove' | 'cancel' | 'drawer' | 'pay' | 'refund' | 'z' | 'unprinted' | null;

interface Line extends StoredLine {
  product: Product | undefined;
  unitPrice: number;
  total: number;
}

/** What the tape shows after a sale: the invoice, the change, and the printer's receipt number once it prints. */
interface LastSale {
  documentId: number;
  number: string;
  total: number;
  change: number | null;
  print: 'printing' | 'printed' | 'failed' | 'none';
  fiscalNo: string | null;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const minutesSince = (time: number, now: number) => Math.max(0, Math.floor((now - time) / 60_000));

/**
 * The Counter: a full-screen till for the shop PC. The barcode scanner works
 * at once, wherever the focus is; every product is on the shelf beside the
 * basket; up to five baskets wait side by side; paying records the sale and
 * prints the fiscal receipt through the Windows app.
 */
export function CounterPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const { logout } = useAuth();
  const scanRef = useRef<HTMLInputElement>(null);
  const shelfSearchRef = useRef<HTMLInputElement>(null);

  const products = useQuery({ queryKey: ['products', 'counter-shelf'], queryFn: counterApi.products, staleTime: 60_000 });
  const settings = useQuery({ queryKey: ['counter', 'settings'], queryFn: counterApi.settings });
  const shopSettings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const today = useQuery({ queryKey: ['counter', 'today'], queryFn: counterApi.today });
  const [panel, setPanel] = useState<Panel>(null);
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list, enabled: panel === 'pay' });
  const printer = useFiscalPrinter(settings.data?.printer.enabled ?? false, t.counter);
  const { baskets, current, setLines, open: openBasket, select: selectBasket, close: closeBasket } = useBaskets(user.id);

  const discountLimit = canOversee(user.role) ? 100 : (shopSettings.data?.employeeDiscountLimit ?? 0);
  const byId = useMemo(() => new Map((products.data ?? []).map((product) => [product.id, product])), [products.data]);

  const lines: Line[] = current.lines.map((line) => {
    const product = byId.get(line.productId);
    const unitPrice = product ? afterDiscount(unitPriceFor(product, line.quantity), parsePercent(line.discount)) : 0;
    return { ...line, product, unitPrice, total: roundMoney(unitPrice * line.quantity) };
  });
  const total = roundMoney(lines.reduce((sum, line) => sum + line.total, 0));
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = lines.find((line) => line.productId === selectedId) ?? lines[lines.length - 1] ?? null;
  const [scan, setScan] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<number | null>(null);
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [printNote, setPrintNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [refundNumber, setRefundNumber] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Baskets show how long their customer has waited.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const say = (text: string) => {
    setProblem(null);
    setNotice(text);
  };
  const complain = (text: string) => {
    setNotice(null);
    setProblem(text);
  };

  const focusScan = useCallback(() => scanRef.current?.focus({ preventScroll: true }), []);

  const record = useCallback(
    (events: CounterEventInput[]) => counterApi.record(events).catch(() => undefined),
    [],
  );

  /** Put one or more of a product in the basket, never more than the shelf holds. */
  function add(product: Product, quantity = 1) {
    const already = current.lines.find((line) => line.productId === product.id)?.quantity ?? 0;
    const stock = product.stock.quantity;
    if (stock <= already) return complain(stock === 0 ? t.counter.outOfStock(product.name) : t.counter.noMore(product.name, stock));
    const next = Math.min(already + quantity, stock);
    setLines((now) =>
      now.some((line) => line.productId === product.id)
        ? now.map((line) => (line.productId === product.id ? { ...line, quantity: next } : line))
        : [...now, { productId: product.id, name: product.name, quantity: next, discount: '' }],
    );
    setSelectedId(product.id);
    setLastAdded(product.id);
    setLastSale(null);
    if (next < already + quantity) complain(t.counter.noMore(product.name, stock));
    else {
      setProblem(null);
      setNotice(null);
    }
  }

  /** Enter in the scan box: a scanner always sends it after the code. "6*" first sells six. */
  async function handleScan(raw: string) {
    const multiplied = /^(\d{1,4})\s*[*xX]\s*(.+)$/.exec(raw.trim());
    const quantity = multiplied ? Math.max(1, Number(multiplied[1])) : 1;
    const code = codeFromScan(multiplied ? multiplied[2]! : raw);
    setScan('');
    if (!code) return;
    const documentNumber = documentNumberFromScan(code);
    if (documentNumber) {
      setRefundNumber(documentNumber);
      return setPanel('refund');
    }
    const shelf = products.data ?? [];
    const lower = code.toLowerCase();
    const exact =
      shelf.find((product) => product.barcode === code || product.otherBarcodes.includes(code)) ??
      shelf.find((product) => product.sku !== null && product.sku.toLowerCase() === lower);
    if (exact) return add(exact, quantity);
    const named = shelf.filter((product) => product.name.toLowerCase().includes(lower));
    if (named.length === 1) return add(named[0]!, quantity);
    if (named.length > 1) {
      setShelfQuery(code);
      setShelfLimit(SHELF_PAGE);
      return;
    }
    try {
      add(await productsApi.byBarcode(code), quantity);
    } catch {
      complain(t.counter.notFound(code));
    }
  }

  function setQuantity(productId: number, quantity: number) {
    const product = byId.get(productId);
    const capped = product ? Math.min(quantity, product.stock.quantity) : quantity;
    if (product && capped < quantity) complain(t.counter.noMore(product.name, product.stock.quantity));
    setLines((now) => now.map((line) => (line.productId === productId ? { ...line, quantity: Math.max(1, capped) } : line)));
  }

  function nudge(step: 1 | -1) {
    if (!selected) return;
    if (step === -1 && selected.quantity === 1) return setPanel('remove');
    setQuantity(selected.productId, selected.quantity + step);
  }

  // ---- Shelf ----
  const [shelfQuery, setShelfQuery] = useState('');
  const [category, setCategory] = useState<number | null>(null);
  const [shelfLimit, setShelfLimit] = useState(SHELF_PAGE);
  const categories = useMemo(() => {
    const counts = new Map<number, { id: number; name: string; count: number }>();
    for (const product of products.data ?? []) {
      const entry = counts.get(product.category.id) ?? { ...product.category, count: 0 };
      entry.count += 1;
      counts.set(product.category.id, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [products.data]);
  const shelf = useMemo(() => {
    const words = shelfQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (products.data ?? [])
      .filter((product) => category === null || product.category.id === category)
      .filter((product) => {
        const haystack = `${product.name} ${product.sku ?? ''} ${product.barcode ?? ''}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .sort((a, b) => Number(b.stock.quantity > 0) - Number(a.stock.quantity > 0) || a.name.localeCompare(b.name));
  }, [products.data, shelfQuery, category]);

  // ---- Paying and printing ----
  const sell = useMutation({
    mutationFn: (payment: Payment) =>
      salesApi.recordBasket({
        items: current.lines.map((line) => {
          const discount = roundMoney(parsePercent(line.discount));
          return { productId: line.productId, quantity: line.quantity, ...(discount > 0 && { discountPercent: discount }) };
        }),
        notes: null,
        ...(payment.paidBy === 'card' && { paidBy: 'card' as const }),
        ...(payment.paidBy === 'tab' && payment.customerId !== null && { customerId: payment.customerId, paidNow: false }),
      }),
  });

  async function pay(payment: Payment) {
    const basketId = current.id;
    const result = await sell.mutateAsync(payment);
    for (const key of ['sales', 'inventory', 'products', 'analytics', 'notifications', 'reports', 'activity', 'customers', 'cash', 'documents', 'money']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    closeBasket(basketId);
    setPanel(null);
    setSelectedId(null);
    setLastAdded(null);
    const change = payment.tendered !== null ? roundMoney(payment.tendered - result.total) : null;
    say(t.counter.sold(formatMoney(result.total), result.invoice.number));
    const willPrint = settings.data?.printer.enabled === true && payment.paidBy !== 'tab';
    setLastSale({ documentId: result.invoice.id, number: result.invoice.number, total: result.total, change, print: willPrint ? 'printing' : 'none', fiscalNo: null });
    focusScan();
    if (!willPrint || !settings.data) return;

    let text: string;
    try {
      text = receiptJob({
        lines: result.sales.map((sale) => {
          const product = byId.get(sale.productId);
          return {
            product: { id: sale.productId, sku: product?.sku ?? null, name: sale.productName, vatRate: product?.vatRate ?? 18 },
            unitPrice: sale.pricePerUnit,
            quantity: sale.quantity,
          };
        }),
        footer: settings.data.receiptFooter,
        taxGroups: settings.data.printer.taxGroups,
        payment: payment.paidBy === 'card' ? { by: 'card' } : { by: 'cash', tendered: payment.tendered },
      });
    } catch (error) {
      const reason = error instanceof MissingTaxGroup ? t.counter.printer.noTaxGroup(error.rate) : errorMessage(error);
      return printFailed({ documentId: result.invoice.id, number: result.invoice.number, total: result.total, at: new Date().toISOString(), text: '', reason });
    }
    const item: Unprinted = { documentId: result.invoice.id, number: result.invoice.number, total: result.total, at: new Date().toISOString(), text, reason: '' };
    const printed = await printer.send(`4VD-${result.invoice.number}`, text);
    await afterPrint(item, printed, false);
  }

  function printFailed(item: Unprinted) {
    printer.keepUnprinted(item);
    setLastSale((sale) => (sale?.documentId === item.documentId ? { ...sale, print: 'failed' } : sale));
    setPrintNote({ ok: false, text: item.reason });
    void record([{ kind: 'print_failed', documentId: item.documentId, reason: item.reason.slice(0, 200) }]);
  }

  async function afterPrint(item: Unprinted, printed: PrintResult, again: boolean) {
    if (!printed.ok) return printFailed({ ...item, reason: printed.message });
    printer.forget(item.documentId);
    setLastSale((sale) => (sale?.documentId === item.documentId ? { ...sale, print: 'printed', fiscalNo: printed.receiptNo } : sale));
    setPrintNote({ ok: true, text: printed.receiptNo ? t.counter.printer.printed(printed.receiptNo) : t.counter.printer.printedNoNumber });
    if (printed.receiptNo) await documentsApi.setFiscalReceipt(item.documentId, printed.receiptNo).catch(() => undefined);
    if (again) void record([{ kind: 'reprinted', documentId: item.documentId }]);
  }

  async function printAgain(item: Unprinted) {
    if (!item.text) return;
    const printed = await printer.send(`4VD-${item.number}`, item.text);
    await afterPrint(item, printed, true);
  }

  async function runReport(kind: 'x' | 'z') {
    const printed = await printer.send(kind === 'x' ? '4VD-X' : '4VD-Z', kind === 'x' ? xReportJob() : zReportJob('4VD'));
    if (!printed.ok) {
      setPrintNote({ ok: false, text: printed.message });
      return;
    }
    await record([{ kind: kind === 'x' ? 'x_report' : 'z_report' }]);
    if (kind === 'z') {
      // Tomorrow's prices go in fresh, as the old program did after every Z.
      await printer.send('4VD-PLU', clearArticlesJob());
    }
    void today.refetch();
    setPrintNote({ ok: true, text: kind === 'x' ? t.counter.xDone : t.counter.zDone });
  }

  // ---- Keys ----
  const keysEnabled = panel === null;
  const hasLines = lines.length > 0;
  const canPrint = printer.reach === 'ready' || printer.reach === 'notRunning' || printer.reach === 'noFolder' || printer.reach === 'checking';
  const startPanel = (next: Panel) => {
    if (['quantity', 'price', 'discount', 'remove'].includes(next ?? '') && !selected) return complain(t.counter.pickLine);
    if ((next === 'pay' || next === 'cancel') && !hasLines) return complain(t.counter.addFirst);
    setPanel(next);
  };
  function newBasket() {
    if (!openBasket()) return complain(t.counter.fullBaskets);
    setSelectedId(null);
    setLastSale(null);
    focusScan();
  }

  // The scanner types like a keyboard: any key pressed outside a field goes to the scan box.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (event: KeyboardEvent) => {
    if (document.querySelector('dialog[open]')) return;
    const shortcuts: Record<string, () => void> = {
      F2: () => startPanel('quantity'),
      F3: () => shelfSearchRef.current?.focus(),
      F4: () => startPanel('discount'),
      F6: () => startPanel('price'),
      F7: () => {
        setRefundNumber(null);
        startPanel('refund');
      },
      F8: newBasket,
      F9: () => startPanel('pay'),
    };
    const shortcut = shortcuts[event.key];
    if (shortcut) {
      event.preventDefault();
      return shortcut();
    }
    if (isTyping(event.target) && event.target !== scanRef.current) return;
    const scanEmpty = scanRef.current?.value === '';
    if (event.key === 'Delete' && scanEmpty) {
      event.preventDefault();
      return startPanel('remove');
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && scanEmpty && hasLines) {
      event.preventDefault();
      const index = Math.max(0, lines.findIndex((line) => line.productId === selected?.productId));
      const next = lines[Math.min(lines.length - 1, Math.max(0, index + (event.key === 'ArrowUp' ? -1 : 1)))];
      if (next) setSelectedId(next.productId);
      return;
    }
    if (event.target !== scanRef.current && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) focusScan();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  function handleScanKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (scan.trim() === '') return hasLines ? startPanel('pay') : undefined;
      return void handleScan(scan);
    }
    if (scan === '' && (event.key === '+' || event.key === '-')) {
      event.preventDefault();
      nudge(event.key === '+' ? 1 : -1);
    }
  }

  const closePanel = () => {
    setPanel(null);
    window.setTimeout(focusScan, 0);
  };

  // ---- Printer status ----
  const reachText: Record<typeof printer.reach, string> = {
    checking: t.counter.printer.label,
    off: t.counter.printer.off,
    browser: t.counter.printer.browser,
    oldApp: t.counter.printer.oldApp,
    noFolder: t.counter.printer.noFolder(printer.path),
    notRunning: t.counter.printer.notRunning,
    ready: t.counter.printer.ready,
  };
  const printerTone = printer.busy ? 'busy' : printer.reach === 'ready' ? 'ok' : printer.reach === 'off' || printer.reach === 'checking' ? 'quiet' : 'warn';
  const printerHint =
    printer.reach === 'off' ? t.counter.printer.offHint : printer.reach === 'browser' ? t.counter.printer.browserHint : printer.reach === 'notRunning' ? t.counter.printer.notRunningHint : undefined;

  const lastProduct = lastAdded !== null ? byId.get(lastAdded) : undefined;
  const lowStockLeft = lastProduct ? lastProduct.stock.quantity - (current.lines.find((line) => line.productId === lastProduct.id)?.quantity ?? 0) : null;

  return (
    <div className="counter">
      <header className="counter__bar">
        <div className="counter__brand">
          <LogoMark size={28} />
          <div>
            <h1 className="counter__title">{t.counter.title}</h1>
            <p className="counter__who">{t.counter.signedInAs(user.name)}</p>
          </div>
        </div>
        <div className="counter__status">
          <p className={`counter-printer counter-printer--${printerTone}`} role="status" title={printerHint}>
            {printer.busy ? (
              <CircleNotch size={16} weight="bold" className="button__spinner" aria-hidden="true" />
            ) : (
              <Printer size={16} weight="bold" aria-hidden="true" />
            )}
            <span>{printer.busy ? t.counter.printer.printing : reachText[printer.reach]}</span>
          </p>
          {printer.unprinted.length > 0 && (
            <Button size="sm" variant="danger" icon={WarningCircle} onClick={() => setPanel('unprinted')}>
              {t.counter.notPrinted(printer.unprinted.length)}
            </Button>
          )}
          {counterOnly(user.role) ? (
            <Button size="sm" variant="ghost" icon={SignOut} onClick={() => void logout()}>
              {t.counter.logOut}
            </Button>
          ) : (
            <ButtonLink size="sm" variant="ghost" icon={ArrowLeft} to="/sales">
              {t.counter.back}
            </ButtonLink>
          )}
        </div>
      </header>

      <main className="counter__main">
        <section className="counter-shelf" aria-label={t.counter.shelf}>
          <div className="counter-shelf__head">
            <label className="counter-search">
              <MagnifyingGlass size={16} aria-hidden="true" />
              <span className="visually-hidden">{t.counter.shelfSearch}</span>
              <input
                ref={shelfSearchRef}
                type="search"
                autoComplete="off"
                placeholder={`${t.counter.shelfSearch} (F3)`}
                value={shelfQuery}
                onChange={(event) => {
                  setShelfQuery(event.target.value);
                  setShelfLimit(SHELF_PAGE);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setShelfQuery('');
                    focusScan();
                  }
                  if (event.key === 'Enter' && shelf.length > 0) {
                    event.preventDefault();
                    add(shelf[0]!);
                  }
                }}
              />
            </label>
            <p className="counter-shelf__count">{products.data ? t.counter.shelfCount(Math.min(shelf.length, shelfLimit), shelf.length) : ''}</p>
          </div>
          <div className="counter-chips" role="group" aria-label={t.counter.shelf}>
            <button type="button" className="chip" aria-pressed={category === null} onClick={() => setCategory(null)}>
              {t.counter.allCategories}
            </button>
            {categories.map((entry) => (
              <button key={entry.id} type="button" className="chip" aria-pressed={category === entry.id} onClick={() => setCategory(entry.id)}>
                {entry.name}
              </button>
            ))}
          </div>
          {products.isPending ? (
            <ul className="counter-shelf__grid" aria-busy="true">
              {Array.from({ length: 12 }, (_, index) => (
                <li key={index} className="counter-tile counter-tile--skeleton" />
              ))}
            </ul>
          ) : products.isError ? (
            <ErrorNotice error={products.error} onRetry={() => products.refetch()} />
          ) : shelf.length === 0 ? (
            <div className="counter-empty">
              <p className="counter-empty__title">{t.counter.nothingOnShelf}</p>
              <p className="counter-hint">{t.counter.nothingOnShelfHint}</p>
            </div>
          ) : (
            <>
              <ul className="counter-shelf__grid">
                {shelf.slice(0, shelfLimit).map((product) => {
                  const price = unitPriceFor(product, 1);
                  const out = product.stock.quantity <= 0;
                  const low = !out && product.stock.isLowStock;
                  return (
                    <li key={product.id}>
                      <button
                        type="button"
                        className={out ? 'counter-tile counter-tile--out' : 'counter-tile'}
                        disabled={out}
                        aria-label={t.counter.addToBasket(product.name, formatMoney(price))}
                        onClick={() => {
                          add(product);
                          focusScan();
                        }}
                      >
                        <span className="counter-tile__name">{product.name}</span>
                        <span className="counter-tile__foot">
                          <span className="counter-tile__price">{formatMoney(price)}</span>
                          <span className={out ? 'counter-tile__stock counter-tile__stock--out' : low ? 'counter-tile__stock counter-tile__stock--low' : 'counter-tile__stock'}>
                            {out ? t.stockTag.out : t.counter.stockLeft(product.stock.quantity)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {shelf.length > shelfLimit && (
                <div className="counter-shelf__more">
                  <Button onClick={() => setShelfLimit((limit) => limit + SHELF_PAGE * 2)}>{t.counter.showMore}</Button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="counter-till" aria-label={t.counter.title}>
          <div className="counter-scan">
            <label className="counter-scan__field">
              <Barcode size={22} aria-hidden="true" />
              <span className="visually-hidden">{t.counter.scan}</span>
              <input
                ref={scanRef}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder={t.counter.scan}
                aria-describedby="counter-scan-hint"
                value={scan}
                onChange={(event) => {
                  setScan(event.target.value);
                  setProblem(null);
                }}
                onKeyDown={handleScanKey}
              />
            </label>
            <p id="counter-scan-hint" className="counter-hint">
              {t.counter.scanHint}
            </p>
            <div aria-live="polite" className="counter-scan__messages">
              {problem && (
                <p className="counter-message counter-message--problem" role="alert">
                  <WarningCircle size={16} weight="bold" aria-hidden="true" />
                  {problem}
                </p>
              )}
              {notice && !problem && (
                <p className="counter-message counter-message--ok">
                  <CheckCircle size={16} weight="bold" aria-hidden="true" />
                  {notice}
                </p>
              )}
            </div>
          </div>

          <div className="counter-baskets" role="group" aria-label={t.counter.baskets}>
            {baskets.map((basket, index) => {
              const basketTotal = roundMoney(
                basket.lines.reduce((sum, line) => {
                  const product = byId.get(line.productId);
                  return sum + (product ? afterDiscount(unitPriceFor(product, line.quantity), parsePercent(line.discount)) * line.quantity : 0);
                }, 0),
              );
              const minutes = minutesSince(basket.startedAt, now);
              return (
                <button
                  key={basket.id}
                  type="button"
                  className="counter-basket"
                  aria-pressed={basket.id === current.id}
                  aria-label={t.counter.basketLabel(index + 1, formatMoney(basketTotal), minutes)}
                  onClick={() => {
                    selectBasket(basket.id);
                    setSelectedId(null);
                    focusScan();
                  }}
                >
                  <span className="counter-basket__name">{t.counter.basketTab(index + 1)}</span>
                  <span className="counter-basket__meta">
                    {basket.lines.length > 0 ? formatMoney(basketTotal) : '—'} · {t.counter.age(minutes)}
                  </span>
                </button>
              );
            })}
            <Button size="sm" variant="ghost" icon={Plus} onClick={newBasket} title="F8">
              {t.counter.newBasket}
            </Button>
          </div>

          <div className="counter-tape">
            {lastProduct && lowStockLeft !== null && (
              <p className={lowStockLeft <= lastProduct.stock.reorderLevel ? 'counter-last counter-last--low' : 'counter-last'}>
                <span className="counter-last__kicker">{t.counter.lastScanned}</span>
                <span className="counter-last__name">{lastProduct.name}</span>
                <span className="counter-last__stock">
                  {lowStockLeft <= lastProduct.stock.reorderLevel ? t.counter.lowStock(lowStockLeft) : t.counter.stockLeft(lowStockLeft)}
                </span>
              </p>
            )}
            {hasLines ? (
              <ol className="counter-lines" aria-label={t.counter.lines}>
                {lines.map((line) => {
                  const percent = parsePercent(line.discount);
                  const isSelected = selected?.productId === line.productId;
                  return (
                    <li key={line.productId}>
                      <button
                        type="button"
                        className="counter-line"
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSelectedId(line.productId);
                          focusScan();
                        }}
                      >
                        <span className="counter-line__name">{line.product?.name ?? line.name}</span>
                        <span className="counter-line__total">{formatMoney(line.total)}</span>
                        <span className="counter-line__detail">
                          {line.quantity} × {formatMoney(line.unitPrice)}
                          {percent > 0 && <span className="counter-line__rabat"> · {t.counter.rabat(`${percent}%`)}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : lastSale ? (
              <div className="counter-sold">
                <p className="counter-sold__number">{lastSale.number}</p>
                <p className="counter-sold__total">{formatMoney(lastSale.total)}</p>
                {lastSale.change !== null && lastSale.change > 0 && (
                  <p className="counter-sold__change">
                    {t.counter.giveBack} <strong>{formatMoney(lastSale.change)}</strong>
                  </p>
                )}
                {lastSale.print === 'printed' && (
                  <p className="counter-stamp">{lastSale.fiscalNo ? t.counter.fiscalNo(lastSale.fiscalNo) : t.counter.printer.printedNoNumber}</p>
                )}
                {lastSale.print === 'failed' && <p className="counter-stamp counter-stamp--failed">{t.counter.printer.failed}</p>}
                {lastSale.print === 'printing' && <p className="counter-hint">{t.counter.printer.printing}</p>}
              </div>
            ) : (
              <div className="counter-empty">
                <Barcode size={32} aria-hidden="true" className="counter-empty__icon" />
                <p className="counter-empty__title">{t.counter.empty}</p>
                <p className="counter-hint">{t.counter.emptyHint}</p>
              </div>
            )}
            <div className="counter-total">
              <span className="counter-total__label">
                {t.counter.total}
                {hasLines && <span className="counter-total__count"> · {t.counter.items(units)}</span>}
              </span>
              <span className="counter-total__amount">{formatMoney(total)}</span>
            </div>
            {printNote && (
              <p className={printNote.ok ? 'counter-message counter-message--ok' : 'counter-message counter-message--problem'} role="status">
                {printNote.ok ? <CheckCircle size={16} weight="bold" aria-hidden="true" /> : <WarningCircle size={16} weight="bold" aria-hidden="true" />}
                {printNote.text}
              </p>
            )}
          </div>

          <div className="counter-keys" role="group" aria-label={t.counter.keys}>
            <CounterKey icon={Tag} label={t.counter.quantity} hotkey="F2" disabled={!keysEnabled || !selected} onClick={() => startPanel('quantity')} />
            <CounterKey icon={HandCoins} label={t.counter.price} hotkey="F6" disabled={!keysEnabled || !selected} onClick={() => startPanel('price')} />
            <CounterKey icon={Percent} label={t.counter.discount} hotkey="F4" disabled={!keysEnabled || !selected} onClick={() => startPanel('discount')} />
            <CounterKey icon={Trash} label={t.counter.remove} hotkey="Del" disabled={!keysEnabled || !selected} onClick={() => startPanel('remove')} />
            <CounterKey
              icon={ArrowCounterClockwise}
              label={t.counter.refund}
              hotkey="F7"
              disabled={!keysEnabled}
              onClick={() => {
                setRefundNumber(null);
                startPanel('refund');
              }}
            />
            <CounterKey icon={X} label={t.counter.cancelBasket} disabled={!keysEnabled || !hasLines} onClick={() => startPanel('cancel')} />
            <CounterKey
              icon={Printer}
              label={t.counter.xReport}
              disabled={!keysEnabled || !canPrint || printer.reach === 'off'}
              title={printer.reach === 'off' ? t.counter.reportNeedsPrinter : undefined}
              onClick={() => void runReport('x')}
            />
            <CounterKey
              icon={Printer}
              label={t.counter.zReport}
              disabled={!keysEnabled || !canPrint || printer.reach === 'off'}
              title={printer.reach === 'off' ? t.counter.reportNeedsPrinter : undefined}
              onClick={() => startPanel('z')}
            />
            {settings.data?.drawerConnected && (
              <CounterKey icon={CashRegister} label={t.counter.openDrawer} disabled={!keysEnabled} onClick={() => startPanel('drawer')} />
            )}
            <Button variant="primary" className="counter-pay" disabled={!hasLines} onClick={() => startPanel('pay')} title="F9 · Enter">
              <span>{t.counter.pay}</span>
              <span className="counter-pay__amount">{formatMoney(total)}</span>
            </Button>
          </div>
        </section>
      </main>

      {selected && (
        <>
          <NumberSheet
            open={panel === 'quantity'}
            title={t.counter.setQuantity(selected.product?.name ?? selected.name)}
            label={t.counter.quantity}
            initial={String(selected.quantity)}
            whole
            check={(value) => (value < 1 ? t.counter.reasonNeeded : null)}
            onClose={closePanel}
            onApply={(value) => {
              setQuantity(selected.productId, value);
              closePanel();
            }}
          />
          <NumberSheet
            open={panel === 'discount'}
            title={t.counter.setDiscount(selected.product?.name ?? selected.name)}
            label={`${t.counter.discount} %`}
            hint={t.counter.discountUpTo(discountLimit)}
            initial={selected.discount}
            check={(value) => (value > discountLimit ? t.counter.discountTooHigh(discountLimit) : null)}
            onClose={closePanel}
            onApply={(value) => {
              setLines((now) => now.map((line) => (line.productId === selected.productId ? { ...line, discount: value > 0 ? String(roundMoney(value)) : '' } : line)));
              closePanel();
            }}
          />
          {selected.product && (
            <NumberSheet
              open={panel === 'price'}
              title={t.counter.setPrice(selected.product.name)}
              label={t.counter.price}
              hint={t.counter.setPriceHint(formatMoney(unitPriceFor(selected.product, selected.quantity)))}
              initial={selected.unitPrice.toFixed(2)}
              check={(value) => {
                const shelfPrice = unitPriceFor(selected.product!, selected.quantity);
                if (value > shelfPrice) return t.counter.setPriceHint(formatMoney(shelfPrice));
                return roundMoney((1 - value / shelfPrice) * 100) > discountLimit ? t.counter.priceTooLow(discountLimit) : null;
              }}
              onClose={closePanel}
              onApply={(value) => {
                const shelfPrice = unitPriceFor(selected.product!, selected.quantity);
                const percent = shelfPrice > 0 ? roundMoney((1 - value / shelfPrice) * 100) : 0;
                setLines((now) => now.map((line) => (line.productId === selected.productId ? { ...line, discount: percent > 0 ? String(percent) : '' } : line)));
                closePanel();
              }}
            />
          )}
          <ReasonSheet
            open={panel === 'remove'}
            title={t.counter.removeTitle(selected.product?.name ?? selected.name)}
            reasons={['scannedTwice', 'changedMind', 'wrongProduct']}
            confirm={t.counter.confirmRemove}
            onClose={closePanel}
            onConfirm={async (reason) => {
              await counterApi.record([{ kind: 'line_removed', productId: selected.productId, quantity: selected.quantity, amount: selected.total, reason }]);
              setLines((now) => now.filter((line) => line.productId !== selected.productId));
              setSelectedId(null);
              closePanel();
            }}
          />
        </>
      )}
      <ReasonSheet
        open={panel === 'cancel'}
        title={t.counter.cancelTitle}
        reasons={['leftWithout', 'changedMind']}
        confirm={t.counter.confirmCancel}
        onClose={closePanel}
        onConfirm={async (reason) => {
          await counterApi.record([{ kind: 'basket_cancelled', quantity: Math.max(1, units), amount: total, reason }]);
          closeBasket(current.id);
          setSelectedId(null);
          closePanel();
        }}
      />
      <ReasonSheet
        open={panel === 'drawer'}
        title={t.counter.drawerTitle}
        reasons={['change']}
        confirm={t.counter.confirmDrawer}
        onClose={closePanel}
        onConfirm={async (reason) => {
          await counterApi.record([{ kind: 'drawer_opened', reason }]);
          say(t.counter.drawerOpened);
          closePanel();
        }}
      />
      <PaySheet open={panel === 'pay'} total={total} customers={customers.data} onClose={closePanel} onPay={pay} />
      <RefundSheet
        open={panel === 'refund'}
        initialNumber={refundNumber}
        onClose={closePanel}
        onDone={(message) => {
          say(message);
          closePanel();
        }}
      />
      <ZSheet
        open={panel === 'z'}
        lastZ={today.data?.lastZ ?? null}
        onClose={closePanel}
        onRun={async () => {
          closePanel();
          await runReport('z');
        }}
      />
      <UnprintedSheet
        open={panel === 'unprinted'}
        items={printer.unprinted}
        canPrint={canPrint && printer.reach !== 'off'}
        onClose={closePanel}
        onPrint={printAgain}
        onLeave={(item) => printer.forget(item.documentId)}
      />
    </div>
  );
}

/** A till key: an icon, its name and the keyboard key that does the same. */
function CounterKey({ icon, label, hotkey, disabled, title, onClick }: { icon: Icon; label: string; hotkey?: string; disabled?: boolean; title?: string; onClick: () => void }) {
  return (
    <Button className="counter-key" icon={icon} disabled={disabled} title={title} aria-keyshortcuts={hotkey === 'Del' ? 'Delete' : hotkey} onClick={onClick}>
      <span>{label}</span>
      {hotkey && (
        <kbd className="counter-key__hotkey" aria-hidden="true">
          {hotkey}
        </kbd>
      )}
    </Button>
  );
}
