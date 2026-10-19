import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowSquareOut,
  Barcode,
  Calculator,
  CashRegister,
  CheckCircle,
  CircleNotch,
  Coins,
  HandCoins,
  Hash,
  MagnifyingGlass,
  Percent,
  Plus,
  Printer,
  SealPercent,
  SignOut,
  Tag,
  Trash,
  User,
  UsersThree,
  WarningCircle,
  WifiHigh,
  WifiSlash,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canOversee, counterOnly } from '../auth/roles';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { useSearchParams } from 'react-router';
import { afterDiscount, parsePercent, roundMoney, unitPriceFor } from '../components/BasketForm';
import { CameraScanButton } from '../components/CameraScanner';
import { LogoMark } from '../components/LogoMark';
import { Button, ButtonLink } from '../components/ui';
import { useT } from '../i18n/useT';
import { cashApi, counterApi, customersApi, documentsApi, expiryApi, productsApi, salesApi, settingsApi } from '../services/api';
import type { CounterEventInput, Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney, formatTime } from '../utils/format';
import { MissingTaxGroup, clearArticlesJob, displayFor, receiptJob, xReportJob, zReportJob } from '../utils/fiscalReceipt';
import { codeFromScan, documentNumberFromScan } from '../utils/scanLinks';
import { priceLine, summarise } from './counter/basketMath';
import { BasketSummaryFoot, BasketTable, SaleHead } from './counter/BasketTable';
import { CASH_TOLERANCE } from '../components/CashCount';
import { CountSheet, CustomerSheet, NumberSheet, PinSheet, PayPanel, type Payment, ReasonSheet, UnprintedSheet, ZSheet } from './counter/CounterSheets';
import { changeFor, EMPTY_PAY, type PayDraft, splitFor } from './counter/payDraft';
import { ProductFinder } from './counter/ProductFinder';
import { RefundSheet } from './counter/RefundSheet';
import { readScaleLabel } from './counter/scaleLabel';
import { playScanSound } from './counter/scanSound';
import { useBaskets } from './counter/useBaskets';
import { type PrintResult, type Unprinted, useFiscalPrinter } from './counter/useFiscalPrinter';

type Panel =
  | 'find'
  | 'quantity'
  | 'price'
  | 'discount'
  | 'basketRabat'
  | 'customer'
  | 'remove'
  | 'cancel'
  | 'drawer'
  | 'pay'
  | 'refund'
  | 'z'
  | 'unprinted'
  | 'opening'
  | 'count'
  | 'switch'
  | 'approve'
  | null;

/** What the till shows after a sale: the invoice, how it was paid, the change, and the printer's receipt number once it prints. */
interface LastSale {
  documentId: number;
  number: string;
  total: number;
  paidBy: Payment['paidBy'];
  tendered: number | null;
  change: number | null;
  /** Cash + card: the part on the card terminal. */
  cardAmount: number | null;
  customerName: string | null;
  print: 'printing' | 'printed' | 'failed' | 'none';
  fiscalNo: string | null;
}

/** A scan that went wrong, shown big over the basket until the next scan or Esc. */
interface Alarm {
  title: string;
  detail: string;
  todo: string;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Kilos are kept to the gram; pieces stay whole. */
const toGram = (amount: number) => Math.round(amount * 1000) / 1000;

const minutesSince = (time: number, now: number) => Math.max(0, Math.floor((now - time) / 60_000));

/** Whether the browser can reach the internet, kept up to date. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * The Counter: a full-screen till for the shop PC. The barcode scanner works
 * at once, wherever the focus is; the basket is a line table with every
 * price, rabat, VAT and stock figure; up to five baskets wait side by side;
 * paying records the sale and prints the fiscal receipt through the Windows app.
 */
export function CounterPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const { logout, adoptSession } = useAuth();
  const scanRef = useRef<HTMLInputElement>(null);
  const online = useOnline();

  const products = useQuery({ queryKey: ['products', 'counter-shelf'], queryFn: counterApi.products, staleTime: 60_000 });
  const settings = useQuery({ queryKey: ['counter', 'settings'], queryFn: counterApi.settings });
  const shopSettings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const today = useQuery({ queryKey: ['counter', 'today'], queryFn: counterApi.today });
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  // The shop drawer today: its opening cash and whether it was counted (never what 4VD expects).
  const cash = useQuery({ queryKey: ['cash', 'today'], queryFn: cashApi.today });
  const shopDrawer = cash.data?.find((drawer) => drawer.place === 'shop') ?? null;
  const needsOpening = shopDrawer !== null && shopDrawer.opening === null && shopDrawer.countedAt === null;
  const expiries = useQuery({ queryKey: ['expiry', 'upcoming'], queryFn: expiryApi.upcoming, staleTime: 5 * 60_000 });
  const [panel, setPanel] = useState<Panel>(null);
  const printer = useFiscalPrinter(settings.data?.printer.enabled ?? false, t.counter);
  const { baskets, current, setLines, update: updateBasket, open: openBasket, select: selectBasket, close: closeBasket } = useBaskets(user.id);

  const discountLimit = canOversee(user.role) ? 100 : (shopSettings.data?.employeeDiscountLimit ?? 0);
  const byId = useMemo(() => new Map((products.data ?? []).map((product) => [product.id, product])), [products.data]);
  // Days to the soonest date still on the shelf, per product.
  const expiry = useMemo(() => {
    const soonest = new Map<number, number>();
    for (const date of expiries.data ?? []) {
      if (date.remaining <= 0) continue;
      const known = soonest.get(date.productId);
      if (known === undefined || date.daysLeft < known) soonest.set(date.productId, date.daysLeft);
    }
    return soonest;
  }, [expiries.data]);

  const basketRabat = current.discount ?? '';
  const lines = current.lines.map((line) => priceLine(line, byId.get(line.productId), basketRabat));
  const summary = summarise(lines);
  const total = summary.total;
  const customer = current.customerId ? (customers.data?.find((one) => one.id === current.customerId) ?? null) : null;

  // The printer's customer display, unless Settings → Counter turned it off.
  const display = useCallback(
    (text: [string, string]) => {
      if (settings.data?.customerDisplay !== false) printer.show(text);
    },
    [settings.data?.customerDisplay, printer],
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = lines.find((line) => line.productId === selectedId) ?? lines[lines.length - 1] ?? null;
  const [scan, setScan] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: number; key: number } | null>(null);
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [payDraft, setPayDraft] = useState<PayDraft>(EMPTY_PAY);
  const [printNote, setPrintNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [refundNumber, setRefundNumber] = useState<string | null>(null);
  const [finderQuery, setFinderQuery] = useState('');
  const [priceCheck, setPriceCheck] = useState(false);
  const [checked, setChecked] = useState<Product | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // An owner's yes on this basket raises the rabat limit until it runs out.
  const approval = current.approval && Date.parse(current.approval.expiresAt) > now ? current.approval : null;
  const rabatLimit = Math.max(discountLimit, approval?.percent ?? 0);
  // A rabat waiting for the owner's PIN, and what to do once they allow it.
  const [ask, setAsk] = useState<{ percent: number; apply: () => void } | null>(null);
  const askOwner = (percent: number, apply: () => void) => {
    setAsk({ percent: roundMoney(percent), apply });
    setPanel('approve');
  };
  const canAsk = !canOversee(user.role);
  const switchPeople = useQuery({ queryKey: ['counter', 'pin-people', user.id], queryFn: () => counterApi.pinPeople(false), enabled: panel === 'switch' });
  const approvers = useQuery({ queryKey: ['counter', 'approvers', user.id], queryFn: () => counterApi.pinPeople(true), enabled: panel === 'approve' });

  // The clock in the status bar, and how long each basket's customer has waited.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
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
  /** A failed scan: the small line for screen readers, and the big red sheet nobody can miss. */
  const alarmFor = (text: string, next: Alarm) => {
    complain(text);
    setAlarm(next);
  };

  const focusScan = useCallback(() => scanRef.current?.focus({ preventScroll: true }), []);

  const record = useCallback(
    (events: CounterEventInput[]) => counterApi.record(events).catch(() => undefined),
    [],
  );

  /** The beep or the buzz after a scan, unless Settings → Counter turned them off. */
  const sound = (kind: 'ok' | 'fail') => {
    if (settings.data?.scanSounds !== false) playScanSound(kind);
  };

  /** Put one or more of a product in the basket, never more than the shelf holds. False when not all of them went in. */
  function add(product: Product, quantity = 1): boolean {
    const already = current.lines.find((line) => line.productId === product.id)?.quantity ?? 0;
    const stock = product.stock.quantity;
    if (stock <= already) {
      if (stock === 0) alarmFor(t.counter.outOfStock(product.name), { title: t.counter.alarm.outOfStock, detail: product.name, todo: t.counter.alarm.stockTodo });
      else alarmFor(t.counter.noMore(product.name, stock), { title: t.counter.alarm.noMore, detail: t.counter.noMore(product.name, stock), todo: t.counter.alarm.stockTodo });
      return false;
    }
    const next = toGram(Math.min(already + quantity, stock));
    setLines((now) =>
      now.some((line) => line.productId === product.id)
        ? now.map((line) => (line.productId === product.id ? { ...line, quantity: next } : line))
        : [...now, { productId: product.id, name: product.name, quantity: next, discount: '' }],
    );
    setSelectedId(product.id);
    setFlash((was) => ({ id: product.id, key: (was?.key ?? 0) + 1 }));
    setLastSale(null);
    setChecked(null);
    setPrintNote((note) => (note?.ok ? null : note));
    if (next < toGram(already + quantity)) {
      alarmFor(t.counter.noMore(product.name, stock), { title: t.counter.alarm.noMore, detail: t.counter.noMore(product.name, stock), todo: t.counter.alarm.partTodo(next) });
      return false;
    }
    setAlarm(null);
    setProblem(null);
    setNotice(null);
    return true;
  }

  /** Price check: show the product, put nothing in the basket. */
  function showCheck(product: Product) {
    setPriceCheck(false);
    setChecked(product);
    setProblem(null);
    setNotice(null);
  }

  // Each product as it goes in: its name and price on the customer display.
  const flashKey = flash?.key;
  useEffect(() => {
    if (flashKey === undefined) return;
    const line = lines.find((one) => one.productId === flash?.id);
    if (line) display(displayFor.item(line.product?.name ?? line.name, line.quantity, line.unitPrice, line.total));
    // Only a new scan shows; a price change on the line waits for the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey]);
  // Paying: the total.
  useEffect(() => {
    if (panel === 'pay') display(displayFor.total(total));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // "Sell it" on a product page opens the Counter with ?add=<product id>: put one in the basket once the shelf is in.
  const [params, setParams] = useSearchParams();
  const addId = Number(params.get('add'));
  useEffect(() => {
    if (!addId || !products.data) return;
    const product = byId.get(addId);
    setParams({}, { replace: true });
    if (product) add(product);
    // add() reads the current basket; running once per ?add= is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addId, products.data]);

  /** Enter in the scan box: a scanner always sends it after the code. "6*" first sells six. */
  async function handleScan(raw: string) {
    const multiplied = /^(\d{1,4})\s*[*xX]\s*(.+)$/.exec(raw.trim());
    const quantity = multiplied ? Math.max(1, Number(multiplied[1])) : 1;
    const code = codeFromScan(multiplied ? multiplied[2]! : raw);
    setScan('');
    setAlarm(null);
    if (!code) return;
    const take = (product: Product) => {
      if (priceCheck) {
        showCheck(product);
        return sound('ok');
      }
      sound(add(product, quantity) ? 'ok' : 'fail');
    };
    const documentNumber = documentNumberFromScan(code);
    if (documentNumber && !priceCheck) {
      setRefundNumber(documentNumber);
      return setPanel('refund');
    }
    const shelf = products.data ?? [];
    const lower = code.toLowerCase();
    const exact =
      shelf.find((product) => product.barcode === code || product.otherBarcodes.includes(code)) ??
      shelf.find((product) => product.sku !== null && product.sku.toLowerCase() === lower);
    if (exact) return take(exact);
    // A label from the shop scale: the product by its scale number, the weight in the code.
    const label = readScaleLabel(code);
    if (label) {
      const weighed =
        shelf.find((product) => product.unit === 'kg' && product.scalePlu === label.plu) ??
        shelf.find((product) => product.unit === 'kg' && product.scalePlu === null && product.sku === String(label.plu));
      if (weighed) {
        if (priceCheck) return take(weighed);
        return sound(add(weighed, label.kg) ? 'ok' : 'fail');
      }
      alarmFor(t.counter.alarm.noScalePlu(label.plu), { title: t.counter.alarm.noScalePlu(label.plu), detail: code, todo: t.counter.alarm.noScalePluTodo });
      return sound('fail');
    }
    const named = shelf.filter((product) => product.name.toLowerCase().includes(lower));
    if (named.length === 1) return take(named[0]!);
    if (named.length > 1) {
      setFinderQuery(code);
      return setPanel('find');
    }
    try {
      take(await productsApi.byBarcode(code));
    } catch {
      alarmFor(t.counter.notFound(code), { title: t.counter.alarm.notFound, detail: code, todo: t.counter.alarm.notFoundTodo });
      sound('fail');
    }
  }

  function setQuantity(productId: number, quantity: number) {
    const product = byId.get(productId);
    const capped = product ? Math.min(quantity, product.stock.quantity) : quantity;
    if (product && capped < quantity) complain(t.counter.noMore(product.name, product.stock.quantity));
    const least = product?.unit === 'kg' ? 0.001 : 1;
    setLines((now) => now.map((line) => (line.productId === productId ? { ...line, quantity: Math.max(least, toGram(capped)) } : line)));
  }

  function nudge(step: 1 | -1) {
    if (!selected) return;
    if (step === -1 && selected.quantity - 1 < (selected.product?.unit === 'kg' ? 0.001 : 1)) return setPanel('remove');
    setQuantity(selected.productId, selected.quantity + step);
  }

  function applyLineRabat(productId: number, value: number) {
    setLines((lines) => lines.map((line) => (line.productId === productId ? { ...line, discount: value > 0 ? String(roundMoney(value)) : '', priceSet: false } : line)));
  }

  function applyPrice(productId: number, percent: number) {
    setLines((lines) => lines.map((line) => (line.productId === productId ? { ...line, discount: percent > 0 ? String(percent) : '', priceSet: percent > 0 } : line)));
  }

  // ---- Paying and printing ----
  const sell = useMutation({
    mutationFn: (payment: Payment) =>
      salesApi.recordBasket({
        items: lines.map((line) => {
          const discount = roundMoney(line.percent);
          return { productId: line.productId, quantity: line.quantity, ...(discount > 0 && { discountPercent: discount }) };
        }),
        notes: null,
        ...(payment.paidBy === 'card' && { paidBy: 'card' as const }),
        ...(payment.paidBy === 'split' && payment.cardAmount !== null && { cardAmount: payment.cardAmount }),
        ...(approval && lines.some((line) => roundMoney(line.percent) > discountLimit) && { rabatApproval: approval.token }),
        ...(payment.paidBy === 'tab' && payment.customerId !== null && { customerId: payment.customerId, paidNow: false }),
        // A customer picked with F5 who pays now: the sale goes on their record, not their tab.
        ...(payment.paidBy !== 'tab' && current.customerId && { customerId: current.customerId, paidNow: true }),
      }),
  });

  async function pay(payment: Payment) {
    const basketId = current.id;
    const result = await sell.mutateAsync(payment);
    for (const key of ['sales', 'inventory', 'products', 'analytics', 'notifications', 'reports', 'activity', 'customers', 'cash', 'documents', 'money']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    void today.refetch();
    closeBasket(basketId);
    setPanel(null);
    setSelectedId(null);
    setFlash(null);
    const card = payment.paidBy === 'split' ? (payment.cardAmount ?? 0) : 0;
    const change = payment.tendered !== null ? roundMoney(payment.tendered - (result.total - card)) : null;
    const buyer = payment.paidBy === 'tab' ? customers.data?.find((one) => one.id === payment.customerId) : customer;
    say(t.counter.sold(formatMoney(result.total), result.invoice.number));
    display(change !== null && change > 0 ? displayFor.change(change) : displayFor.thanks(result.total));
    const willPrint = settings.data?.printer.enabled === true && payment.paidBy !== 'tab';
    setLastSale({
      documentId: result.invoice.id,
      number: result.invoice.number,
      total: result.total,
      paidBy: payment.paidBy,
      tendered: payment.tendered,
      change,
      cardAmount: payment.paidBy === 'split' ? card : null,
      customerName: buyer?.name ?? null,
      print: willPrint ? 'printing' : 'none',
      fiscalNo: null,
    });
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
        // Card and Cash + card print as cash, as the shop's receipts always have; the printer's change is the cash change.
        payment:
          payment.paidBy === 'card'
            ? { by: 'card' }
            : { by: 'cash', tendered: payment.tendered === null ? null : roundMoney(payment.tendered + card) },
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
    setAlarm(null);
    if (['quantity', 'price', 'discount', 'remove'].includes(next ?? '') && !selected) return complain(t.counter.pickLine);
    if ((next === 'pay' || next === 'cancel') && !hasLines) return complain(t.counter.addFirst);
    if (next === 'pay') setPayDraft({ ...EMPTY_PAY, customerId: current.customerId ? String(current.customerId) : '' });
    setPanel(next);
  };
  function newBasket() {
    if (!openBasket()) return complain(t.counter.fullBaskets);
    setSelectedId(null);
    setLastSale(null);
    focusScan();
  }
  function togglePriceCheck() {
    setChecked(null);
    setPriceCheck((on) => !on);
    focusScan();
  }
  const openFinder = () => {
    setFinderQuery('');
    startPanel('find');
  };
  const openRefund = () => {
    setRefundNumber(null);
    startPanel('refund');
  };

  // The scanner types like a keyboard: any key pressed outside a field goes to the scan box.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (event: KeyboardEvent) => {
    if (document.querySelector('dialog[open]')) return;
    // Taking the money: the pay keys have the keyboard; Esc goes back to the basket.
    if (panel === 'pay') {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
      }
      return;
    }
    const shortcuts: Record<string, () => void> = {
      F2: () => startPanel('quantity'),
      F3: openFinder,
      F4: () => startPanel('discount'),
      // F5 would reload the page; at the till it picks the customer.
      F5: () => startPanel('customer'),
      F6: () => startPanel('price'),
      F7: openRefund,
      F8: newBasket,
      F9: () => startPanel('pay'),
      F10: togglePriceCheck,
    };
    const shortcut = shortcuts[event.key];
    if (shortcut) {
      event.preventDefault();
      return shortcut();
    }
    if (event.key === 'Escape' && alarm) {
      event.preventDefault();
      setAlarm(null);
      return;
    }
    if (event.key === 'Escape' && (priceCheck || checked)) {
      event.preventDefault();
      setPriceCheck(false);
      setChecked(null);
      return;
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
      if (scan.trim() === '') return hasLines && !priceCheck ? startPanel('pay') : undefined;
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

  // "6*" typed and waiting for the scan: say so, so nobody wonders why six went in.
  const pending = /^(\d{1,4})\s*[*xX]$/.exec(scan.trim());
  const pendingCount = pending ? Math.max(1, Number(pending[1])) : null;
  const clock = new Date(now).toISOString();

  return (
    <div className="counter">
      <header className="counter__bar">
        <div className="counter__brand">
          <LogoMark size={28} />
          <div>
            <h1 className="visually-hidden">{t.counter.title}</h1>
            <p className="counter__title" aria-hidden="true">
              {t.counter.title}
            </p>
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
          <Button size="sm" variant="ghost" icon={UsersThree} disabled={!online} onClick={() => startPanel('switch')} aria-label={t.counter.switchKey} title={t.counter.switchKey}>
            <span className="counter__bar-label">{t.counter.switchKey}</span>
          </Button>
          {counterOnly(user.role) ? (
            <>
              {/* On a phone these two shrink to their icons, so the printer's state keeps its room. */}
              <ButtonLink size="sm" variant="ghost" icon={ArrowLeft} to="/" aria-label={t.staff.nav.home} title={t.staff.nav.home}>
                <span className="counter__bar-label">{t.staff.nav.home}</span>
              </ButtonLink>
              <Button size="sm" variant="ghost" icon={SignOut} onClick={() => void logout()} aria-label={t.counter.logOut} title={t.counter.logOut}>
                <span className="counter__bar-label">{t.counter.logOut}</span>
              </Button>
            </>
          ) : (
            <ButtonLink size="sm" variant="ghost" icon={ArrowLeft} to="/sales">
              {t.counter.back}
            </ButtonLink>
          )}
        </div>
      </header>

      <main className="counter__main">
        <section className="counter-till" aria-label={t.counter.title}>
          <div className="counter-toolbar">
            <div className="counter-scan">
              <label className={priceCheck ? 'counter-scan__field counter-scan__field--check' : 'counter-scan__field'}>
                {priceCheck ? <Tag size={22} aria-hidden="true" /> : <Barcode size={22} aria-hidden="true" />}
                <span className="visually-hidden">{priceCheck ? t.counter.priceCheck : t.counter.scan}</span>
                <input
                  ref={scanRef}
                  name="code"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={priceCheck ? `${t.counter.priceCheck}…` : `${t.counter.scan}…`}
                  aria-describedby="counter-scan-hint"
                  value={scan}
                  onChange={(event) => {
                    setScan(event.target.value);
                    setProblem(null);
                  }}
                  onKeyDown={handleScanKey}
                />
                {pendingCount !== null && (
                  <span className="counter-chip counter-chip--accent" role="status">
                    {t.counter.multiplier(pendingCount)}
                  </span>
                )}
                {priceCheck && (
                  <button type="button" className="counter-chip counter-chip--button" onClick={togglePriceCheck}>
                    {t.counter.priceCheckOff}
                    <kbd aria-hidden="true">Esc</kbd>
                  </button>
                )}
              </label>
              {/* On a phone there's no USB scanner: the camera reads the code instead. */}
              <span className="counter-scan__camera">
                <CameraScanButton iconOnly onScan={(code) => void handleScan(code)} />
              </span>
              <p id="counter-scan-hint" className="visually-hidden">
                {priceCheck ? t.counter.priceCheckOn : t.counter.scanHint}
              </p>
            </div>

            <div className="counter-baskets" role="group" aria-label={t.counter.baskets}>
              {baskets.map((basket, index) => {
                const basketTotal = roundMoney(
                  basket.lines.reduce((sum, line) => {
                    const product = byId.get(line.productId);
                    const percent = parsePercent(line.discount) || parsePercent(basket.discount ?? '');
                    return sum + (product ? afterDiscount(unitPriceFor(product, line.quantity), percent) * line.quantity : 0);
                  }, 0),
                );
                const minutes = minutesSince(basket.startedAt, now);
                return (
                  <button
                    key={basket.id}
                    type="button"
                    className="counter-basket"
                    aria-pressed={basket.id === current.id}
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
              <Button size="sm" variant="ghost" icon={Plus} onClick={newBasket} title="F8" aria-keyshortcuts="F8">
                {t.counter.newBasket}
              </Button>
            </div>
          </div>

          <div aria-live="polite" className="counter-messages">
            {priceCheck && (
              <p className="counter-message counter-message--info" role="status">
                <Tag size={16} weight="bold" aria-hidden="true" />
                {t.counter.priceCheckOn}
              </p>
            )}
            {problem && (
              <p className="counter-message counter-message--problem" role="alert">
                <WarningCircle size={16} weight="bold" aria-hidden="true" />
                {problem}
              </p>
            )}
            {printNote && (
              <p className={printNote.ok ? 'counter-message counter-message--ok' : 'counter-message counter-message--problem'} role="status">
                {printNote.ok ? <CheckCircle size={16} weight="bold" aria-hidden="true" /> : <WarningCircle size={16} weight="bold" aria-hidden="true" />}
                {printNote.text}
              </p>
            )}
            {notice && !problem && (
              <p className="counter-message counter-message--ok">
                <CheckCircle size={16} weight="bold" aria-hidden="true" />
                {notice}
              </p>
            )}
          </div>

          <div className="counter-tape">
            {alarm && (
              <ScanAlarm
                alarm={alarm}
                onClose={() => {
                  setAlarm(null);
                  focusScan();
                }}
              />
            )}
            <SaleHead
              customerName={customer?.name ?? null}
              nextReceipt={today.data?.nextReceipt ?? null}
              startedAt={formatTime(new Date(current.startedAt).toISOString())}
              basketRabat={parsePercent(basketRabat)}
              onCustomer={() => startPanel('customer')}
            />
            {checked && <PriceCheckCard product={checked} days={expiry.get(checked.id)} onClose={() => setChecked(null)} />}
            {hasLines ? (
              <BasketTable
                lines={lines}
                selectedId={selected?.productId ?? null}
                flashId={flash?.id ?? null}
                flashKey={flash?.key ?? 0}
                expiry={expiry}
                onSelect={(productId) => {
                  setSelectedId(productId);
                  focusScan();
                }}
              />
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
              !checked && (
                <div className="counter-empty">
                  <Barcode size={32} aria-hidden="true" className="counter-empty__icon" />
                  <p className="counter-empty__title">{t.counter.empty}</p>
                  <p className="counter-hint">{t.counter.emptyHint}</p>
                </div>
              )
            )}
            {hasLines && <BasketSummaryFoot summary={summary} />}
            {panel === 'pay' && <PaidRows draft={payDraft} total={total} customerName={customers.data?.find((one) => String(one.id) === payDraft.customerId)?.name ?? null} />}
          </div>
        </section>

        <section className="counter-side" aria-label={t.counter.keys}>
          {panel === 'pay' ? (
            <PayPanel total={total} customers={customers.data} draft={payDraft} onChange={setPayDraft} onPay={pay} onBack={closePanel} />
          ) : (
            <>
              {needsOpening && (
                <div className="counter-opening">
                  <p>
                    <strong>{t.counter.openingMissing}</strong> {t.counter.openingMissingHint}
                  </p>
                  <Button size="sm" icon={Coins} disabled={!keysEnabled} onClick={() => startPanel('opening')}>
                    {t.counter.openingKey}
                  </Button>
                </div>
              )}
              <Button variant="primary" className="counter-pay" disabled={!hasLines} onClick={() => startPanel('pay')} title="F9 · Enter" aria-keyshortcuts="F9">
                <span className="counter-pay__label">
                  {t.counter.pay}
                  <kbd className="counter-pay__hotkey" aria-hidden="true">
                    F9
                  </kbd>
                </span>
                <span className="counter-pay__amount">{formatMoney(total)}</span>
              </Button>

              <KeyGroup title={selected ? `${t.counter.groups.line} · ${selected.product?.name ?? selected.name}` : t.counter.noLine}>
                <CounterKey icon={Hash} label={t.counter.quantity} hotkey="F2" disabled={!keysEnabled || !selected} onClick={() => startPanel('quantity')} />
                <CounterKey icon={HandCoins} label={t.counter.price} hotkey="F6" disabled={!keysEnabled || !selected} onClick={() => startPanel('price')} />
                <CounterKey icon={Percent} label={t.counter.discount} hotkey="F4" disabled={!keysEnabled || !selected} onClick={() => startPanel('discount')} />
                <CounterKey icon={Trash} label={t.counter.remove} hotkey="Del" disabled={!keysEnabled || !selected} onClick={() => startPanel('remove')} />
              </KeyGroup>

              <KeyGroup title={t.counter.groups.sale}>
                <CounterKey icon={MagnifyingGlass} label={t.counter.search} hotkey="F3" disabled={!keysEnabled} onClick={openFinder} />
                <CounterKey icon={User} label={t.counter.customer} hotkey="F5" disabled={!keysEnabled} onClick={() => startPanel('customer')} />
                <CounterKey icon={SealPercent} label={t.counter.basketRabat} disabled={!keysEnabled || !hasLines} onClick={() => startPanel('basketRabat')} />
                <CounterKey icon={Tag} label={t.counter.priceCheckKey} hotkey="F10" disabled={!keysEnabled} pressed={priceCheck} onClick={togglePriceCheck} />
                <CounterKey icon={X} label={t.counter.cancelBasket} disabled={!keysEnabled || !hasLines} onClick={() => startPanel('cancel')} />
                <CounterKey icon={ArrowCounterClockwise} label={t.counter.refund} hotkey="F7" disabled={!keysEnabled} onClick={openRefund} />
              </KeyGroup>

              <KeyGroup title={t.counter.groups.till} quiet>
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
                <CounterKey icon={Coins} label={t.counter.openingKey} disabled={!keysEnabled || !shopDrawer} onClick={() => startPanel('opening')} />
                <CounterKey icon={Calculator} label={t.counter.countKey} disabled={!keysEnabled || !shopDrawer} onClick={() => startPanel('count')} />
                {settings.data?.drawerConnected && (
                  <CounterKey icon={CashRegister} label={t.counter.openDrawer} disabled={!keysEnabled} onClick={() => startPanel('drawer')} />
                )}
              </KeyGroup>

              {lastSale && <LastSaleCard sale={lastSale} canOpen={canOversee(user.role)} />}
              {today.data && <ShiftCard mine={today.data.mine} cashToday={today.data.cashToday} drawer={today.data.drawer} />}
            </>
          )}
        </section>
      </main>

      <footer className="counter-status">
        <ul className="counter-status__legend" aria-label={t.counter.legend}>
          <LegendKey keys="F2" label={t.counter.legendKeys.quantity} />
          <LegendKey keys="F3" label={t.counter.legendKeys.search} />
          <LegendKey keys="F4" label={t.counter.legendKeys.rabat} />
          <LegendKey keys="F5" label={t.counter.legendKeys.customer} />
          <LegendKey keys="F6" label={t.counter.legendKeys.price} />
          <LegendKey keys="F7" label={t.counter.legendKeys.refund} />
          <LegendKey keys="F8" label={t.counter.legendKeys.newBasket} />
          <LegendKey keys="F9" label={t.counter.legendKeys.pay} />
          <LegendKey keys="F10" label={t.counter.legendKeys.priceCheck} />
          <LegendKey keys="Del" label={t.counter.legendKeys.remove} />
          <LegendKey keys="↑ ↓" label={t.counter.legendKeys.lines} />
          <LegendKey keys="+ −" label={t.counter.legendKeys.nudge} />
        </ul>
        <div className="counter-status__right">
          <p className={online ? 'counter-status__net' : 'counter-status__net counter-status__net--off'} role="status">
            {online ? <WifiHigh size={14} weight="bold" aria-hidden="true" /> : <WifiSlash size={14} weight="bold" aria-hidden="true" />}
            {online ? t.counter.online : t.counter.offline}
          </p>
          <p className="counter-status__clock">
            <span>{formatDate(clock)}</span>
            <time dateTime={clock}>{formatTime(clock)}</time>
          </p>
        </div>
      </footer>

      {selected && (
        <>
          <NumberSheet
            open={panel === 'quantity'}
            title={t.counter.setQuantity(selected.product?.name ?? selected.name)}
            label={selected.product?.unit === 'kg' ? `${t.counter.quantity} (kg)` : t.counter.quantity}
            initial={String(selected.quantity)}
            whole={selected.product?.unit !== 'kg'}
            check={(value) => (value < (selected.product?.unit === 'kg' ? 0.001 : 1) ? t.counter.reasonNeeded : null)}
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
            hint={t.counter.discountUpTo(rabatLimit)}
            initial={selected.discount}
            check={(value) => (value > rabatLimit ? t.counter.discountTooHigh(rabatLimit) : null)}
            askMore={canAsk ? { label: t.counter.askOwner, onAsk: (value) => askOwner(value, () => applyLineRabat(selected.productId, value)) } : undefined}
            onClose={closePanel}
            onApply={(value) => {
              applyLineRabat(selected.productId, value);
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
                return roundMoney((1 - value / shelfPrice) * 100) > rabatLimit ? t.counter.priceTooLow(rabatLimit) : null;
              }}
              askMore={
                canAsk
                  ? {
                      label: t.counter.askOwner,
                      onAsk: (value) => {
                        const shelfPrice = unitPriceFor(selected.product!, selected.quantity);
                        const percent = shelfPrice > 0 ? roundMoney((1 - value / shelfPrice) * 100) : 0;
                        askOwner(percent, () => applyPrice(selected.productId, percent));
                      },
                    }
                  : undefined
              }
              onClose={closePanel}
              onApply={(value) => {
                const shelfPrice = unitPriceFor(selected.product!, selected.quantity);
                applyPrice(selected.productId, shelfPrice > 0 ? roundMoney((1 - value / shelfPrice) * 100) : 0);
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
      <NumberSheet
        open={panel === 'basketRabat'}
        title={t.counter.basketRabatTitle}
        label={`${t.counter.basketRabat} %`}
        hint={t.counter.basketRabatHint(rabatLimit)}
        initial={basketRabat}
        check={(value) => (value > rabatLimit ? t.counter.discountTooHigh(rabatLimit) : null)}
        askMore={canAsk ? { label: t.counter.askOwner, onAsk: (value) => askOwner(value, () => updateBasket({ discount: String(roundMoney(value)) })) } : undefined}
        onClose={closePanel}
        onApply={(value) => {
          updateBasket({ discount: value > 0 ? String(roundMoney(value)) : '' });
          closePanel();
        }}
      />
      <PinSheet
        open={panel === 'approve'}
        title={t.counter.askOwner}
        description={t.counter.askOwnerHint(`${discountLimit}%`)}
        people={approvers.data}
        nobody={t.counter.noApprover}
        submit={t.counter.allow}
        onClose={() => {
          setAsk(null);
          closePanel();
        }}
        onSubmit={async (userId, pin) => {
          if (!ask) return;
          const allowed = await counterApi.allowRabat({ userId, pin, percent: ask.percent, basketId: current.id });
          updateBasket({ approval: allowed });
          ask.apply();
          setAsk(null);
          closePanel();
          say(t.counter.rabatAllowed(allowed.by, `${allowed.percent}%`));
        }}
      />
      <PinSheet
        open={panel === 'switch'}
        title={t.counter.switchTitle}
        description={t.counter.switchHint}
        people={switchPeople.data}
        nobody={t.counter.switchNobody}
        submit={t.counter.takeOver}
        onClose={closePanel}
        onSubmit={async (userId, pin) => {
          const result = await counterApi.switchTo({ userId, pin });
          closePanel();
          await adoptSession(result);
          // Everything on screen was the last person's: My day, permissions, the lists.
          void queryClient.invalidateQueries();
          say(t.counter.switchedTo(result.user.name));
        }}
      />
      <CustomerSheet
        open={panel === 'customer'}
        customers={customers.data}
        current={current.customerId ?? null}
        onClose={closePanel}
        onPick={(picked) => {
          updateBasket({ customerId: picked?.id ?? null });
          if (picked) say(t.counter.customerPicked(picked.name));
          closePanel();
        }}
      />
      <ReasonSheet
        open={panel === 'cancel'}
        title={t.counter.cancelTitle}
        reasons={['leftWithout', 'changedMind']}
        confirm={t.counter.confirmCancel}
        onClose={closePanel}
        onConfirm={async (reason) => {
          await counterApi.record([{ kind: 'basket_cancelled', quantity: Math.max(1, summary.pieces), amount: total, reason }]);
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
      <ProductFinder
        open={panel === 'find'}
        products={products.data}
        error={products.error}
        onRetry={() => products.refetch()}
        initialQuery={finderQuery}
        onClose={closePanel}
        onAdd={(product) => {
          if (!priceCheck) return void add(product);
          showCheck(product);
          closePanel();
        }}
      />
      <RefundSheet
        open={panel === 'refund'}
        initialNumber={refundNumber}
        onClose={closePanel}
        onDone={(message) => {
          say(message);
          closePanel();
        }}
      />
      <NumberSheet
        open={panel === 'opening'}
        title={t.counter.openingTitle}
        label={t.counter.openingLabel}
        hint={t.counter.openingHint(formatMoney(shopDrawer?.float ?? 0))}
        initial={shopDrawer?.opening ? String(shopDrawer.opening.amount) : ''}
        onClose={closePanel}
        check={() => null}
        onApply={(amount) => {
          const rounded = Math.round(amount * 100) / 100;
          closePanel();
          cashApi
            .open({ place: 'shop', amount: rounded })
            .then((drawers) => {
              queryClient.setQueryData(['cash', 'today'], drawers);
              void queryClient.invalidateQueries({ queryKey: ['counter', 'today'] });
              say(t.counter.openingSaved(formatMoney(rounded)));
            })
            .catch((error: unknown) => complain(errorMessage(error)));
        }}
      />
      <CountSheet
        open={panel === 'count'}
        opening={shopDrawer?.opening?.amount ?? shopDrawer?.float ?? 0}
        countedToday={Boolean(shopDrawer?.countedAt)}
        onClose={closePanel}
        onSave={async (counted, note) => {
          const result = await cashApi.count({ place: 'shop', counted, note, float: shopDrawer?.opening?.amount ?? shopDrawer?.float ?? 0 });
          for (const key of [['cash'], ['counter', 'today'], ['activity'], ['notifications']]) void queryClient.invalidateQueries({ queryKey: key });
          closePanel();
          say(result ? t.counter.countSaved(differenceText(result.difference, t.cash)) : t.counter.countSavedBlind);
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
function CounterKey({
  icon,
  label,
  hotkey,
  disabled,
  title,
  pressed,
  onClick,
}: {
  icon: Icon;
  label: string;
  hotkey?: string;
  disabled?: boolean;
  title?: string;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="counter-key"
      icon={icon}
      disabled={disabled}
      title={title}
      aria-pressed={pressed}
      aria-keyshortcuts={hotkey === 'Del' ? 'Delete' : hotkey}
      onClick={onClick}
    >
      <span>{label}</span>
      {hotkey && (
        <kbd className="counter-key__hotkey" aria-hidden="true">
          {hotkey}
        </kbd>
      )}
    </Button>
  );
}

/** Keys that act on the same thing, under a small heading. */
function KeyGroup({ title, quiet, children }: { title: string; quiet?: boolean; children: React.ReactNode }) {
  return (
    <section className={quiet ? 'counter-group counter-group--quiet' : 'counter-group'}>
      <h2 className="counter-group__title">{title}</h2>
      <div className="counter-keys">{children}</div>
    </section>
  );
}

function LegendKey({ keys, label }: { keys: string; label: string }) {
  return (
    <li>
      <kbd>{keys}</kbd>
      {label}
    </li>
  );
}

/** The sale just made: its receipt, how it was paid and the change, and whether it printed. */
function LastSaleCard({ sale, canOpen }: { sale: LastSale; canOpen: boolean }) {
  const t = useT();
  return (
    <section className="counter-card">
      <h2 className="counter-group__title">{t.counter.lastSale}</h2>
      <p className="counter-card__lead">
        <span className="counter-card__mono">{sale.number}</span>
        <strong>{formatMoney(sale.total)}</strong>
      </p>
      <dl className="counter-card__rows">
        <div>
          <dt>{t.counter.paidBy}</dt>
          <dd>{t.counter.paidWith[sale.paidBy]}</dd>
        </div>
        {sale.customerName && (
          <div>
            <dt>{t.counter.customer}</dt>
            <dd>{sale.customerName}</dd>
          </div>
        )}
        {sale.cardAmount !== null && (
          <div>
            <dt>{t.counter.cardPart}</dt>
            <dd>{formatMoney(sale.cardAmount)}</dd>
          </div>
        )}
        {sale.tendered !== null && (
          <div>
            <dt>{t.counter.tendered}</dt>
            <dd>{formatMoney(sale.tendered)}</dd>
          </div>
        )}
        {sale.change !== null && sale.change > 0 && (
          <div className="counter-card__strong">
            <dt>{t.counter.change}</dt>
            <dd>{formatMoney(sale.change)}</dd>
          </div>
        )}
        {sale.print !== 'none' && (
          <div>
            <dt>{t.counter.printer.label}</dt>
            <dd className={sale.print === 'failed' ? 'counter-card__bad' : undefined}>
              {sale.print === 'printing'
                ? t.counter.printer.printing
                : sale.print === 'failed'
                  ? t.counter.printer.failed
                  : sale.fiscalNo
                    ? t.counter.fiscalNo(sale.fiscalNo)
                    : t.counter.printer.printedNoNumber}
            </dd>
          </div>
        )}
      </dl>
      {canOpen && (
        <ButtonLink size="sm" variant="ghost" icon={ArrowSquareOut} to={`/documents/${sale.documentId}`} title={t.counter.copyHint}>
          {t.counter.openInvoice}
        </ButtonLink>
      )}
    </section>
  );
}

/** What the person at the till sold today, and the cash everyone took. */
function ShiftCard({
  mine,
  cashToday,
  drawer,
}: {
  mine: { receipts: number; total: number; cash: number; card: number; tab: number };
  cashToday: number;
  drawer: { opening: number | null; shouldHold: number } | null;
}) {
  const t = useT();
  return (
    <section className="counter-card">
      <h2 className="counter-group__title">{t.counter.shift}</h2>
      <p className="counter-card__lead">
        <span>{t.counter.shiftReceipts(mine.receipts)}</span>
        <strong>{formatMoney(mine.total)}</strong>
      </p>
      <dl className="counter-card__rows">
        <div>
          <dt>{t.counter.shiftCash}</dt>
          <dd>{formatMoney(mine.cash)}</dd>
        </div>
        <div>
          <dt>{t.counter.shiftCard}</dt>
          <dd>{formatMoney(mine.card)}</dd>
        </div>
        {mine.tab > 0 && (
          <div>
            <dt>{t.counter.shiftTab}</dt>
            <dd>{formatMoney(mine.tab)}</dd>
          </div>
        )}
        <div className="counter-card__quiet">
          <dt>{t.counter.cashToday}</dt>
          <dd>{formatMoney(cashToday)}</dd>
        </div>
        {drawer && (
          <>
            <div>
              <dt>{t.counter.openingRow}</dt>
              <dd>{drawer.opening === null ? t.counter.notCounted : formatMoney(drawer.opening)}</dd>
            </div>
            <div>
              <dt>{t.counter.shouldHold}</dt>
              <dd>{formatMoney(drawer.shouldHold)}</dd>
            </div>
          </>
        )}
      </dl>
    </section>
  );
}

/**
 * A scan that didn't work, over the whole basket in red: what went wrong and
 * what to do. The small message line above says the same for screen readers,
 * so this sheet isn't announced again.
 */
function ScanAlarm({ alarm, onClose }: { alarm: Alarm; onClose: () => void }) {
  const t = useT();
  return (
    <div className="counter-alarm">
      <WarningCircle size={56} weight="fill" aria-hidden="true" className="counter-alarm__icon" />
      <p className="counter-alarm__title">{alarm.title}</p>
      <p className="counter-alarm__detail">{alarm.detail}</p>
      <p className="counter-alarm__todo">{alarm.todo}</p>
      <Button variant="secondary" onClick={onClose} aria-keyshortcuts="Escape">
        {t.counter.alarm.ok}
        <kbd className="counter-key__hotkey" aria-hidden="true">
          Esc
        </kbd>
      </Button>
    </div>
  );
}

/** Price check: a product's price, deals and stock, without putting it in the basket. */
function PriceCheckCard({ product, days, onClose }: { product: Product; days: number | undefined; onClose: () => void }) {
  const t = useT();
  const price = unitPriceFor(product, 1);
  return (
    <section className="counter-check" aria-label={t.counter.priceCheckTitle}>
      <div className="counter-check__main">
        <p className="counter-check__kicker">{t.counter.priceCheckTitle}</p>
        <p className="counter-check__name">{product.name}</p>
        <p className="counter-check__meta">
          {product.barcode ?? product.sku ?? ''}
          {product.barcode || product.sku ? ' · ' : ''}
          {t.counter.stockLeft(product.stock.quantity)}
          {days !== undefined && ` · ${t.counter.expires(days)}`}
        </p>
        {product.promotion && price < product.price && <p className="counter-check__deal">{t.counter.reason.promotion(product.promotion.name)}</p>}
        {product.bulkPricingTiers.map((tier) => (
          <p key={tier.quantity} className="counter-check__deal">
            {t.counter.bulkFrom(tier.quantity, formatMoney(tier.price))}
          </p>
        ))}
        <p className="counter-hint">{t.counter.priceCheckNothing}</p>
      </div>
      <div className="counter-check__price">
        {price < product.price && <s className="counter-row__was">{formatMoney(product.price)}</s>}
        <span>{formatMoney(price)}</span>
      </div>
      <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label={t.counter.priceCheckOff} title="Esc" />
    </section>
  );
}

/** Under the total while paying: what the customer gave and the change, or how they pay. */
function PaidRows({ draft, total, customerName }: { draft: PayDraft; total: number; customerName: string | null }) {
  const t = useT();
  const cash = changeFor(draft, total);
  const split = splitFor(draft, total);
  if (draft.paidBy === 'card') return <p className="counter-paid counter-paid--note">{t.counter.paidByCard}</p>;
  if (draft.paidBy === 'tab') return <p className="counter-paid counter-paid--note">{customerName ? t.counter.onTabOf(customerName) : t.counter.pickCustomer}</p>;
  const short = cash !== null && cash.change < 0;
  return (
    <dl className="counter-paid" aria-live="polite">
      {draft.paidBy === 'split' && (
        <div className="counter-paid__row">
          <dt>{t.counter.cardPart}</dt>
          <dd>{split?.valid ? formatMoney(split.card) : '—'}</dd>
        </div>
      )}
      <div className="counter-paid__row">
        <dt>{t.counter.paid}</dt>
        <dd>{cash ? formatMoney(cash.given) : '—'}</dd>
      </div>
      <div className={short ? 'counter-paid__row counter-paid__row--change counter-paid__row--short' : 'counter-paid__row counter-paid__row--change'}>
        <dt>{short ? t.counter.short(formatMoney(-cash.change)) : t.counter.change}</dt>
        <dd>{cash && !short ? formatMoney(cash.change) : '—'}</dd>
      </div>
    </dl>
  );
}

/** How a count came out, in words, for whoever may see it. */
function differenceText(difference: number | null, words: { matches: string; nothingToCompare: string; short: (amount: string) => string; over: (amount: string) => string }): string {
  if (difference === null) return words.nothingToCompare;
  if (Math.abs(difference) < CASH_TOLERANCE) return words.matches;
  return difference < 0 ? words.short(formatMoney(-difference)) : words.over(formatMoney(difference));
}
