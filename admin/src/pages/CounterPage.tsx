import { RollingNumber, SuccessCheck } from '../components/ui';
import { allowsParts, piecesFor, unitSymbol } from '../utils/units';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowSquareOut,
  Barcode,
  Calculator,
  CaretDown,
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
  Receipt,
  SealPercent,
  SignOut,
  Tag,
  Trash,
  Truck,
  User,
  UsersThree,
  WarningCircle,
  WifiHigh,
  WifiSlash,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canOversee, counterOnly } from '../auth/roles';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { useSearchParams } from 'react-router';
import { afterDiscount, parsePercent, roundMoney, unitPriceFor } from '../components/BasketForm';
import { CameraScanButton } from '../components/CameraScanner';
import { LogoMark } from '../components/LogoMark';
import { Badge, Button, ButtonLink, MenuButton, type MenuItem } from '../components/ui';
import { useT } from '../i18n/useT';
import { businessApi, cashApi, counterApi, customersApi, documentsApi, expiryApi, offersApi, productsApi, salesApi, serialsApi, settingsApi, TO_DELIVER_KEY } from '../services/api';
import { useFeatures } from '../utils/useFeatures';
import type { CounterEventInput, Customer, Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney, formatQuantity, formatTime } from '../utils/format';
import { offersByProduct, tapShortDated as nextShortDated } from '../utils/shortDated';
import { MissingTaxGroup, clearArticlesJob, displayFor, receiptJob, xReportJob, zReportJob } from '../utils/fiscalReceipt';
import { drain, keep, localEventStore, type Owner, refusedEntries, unrefuse } from './counter/eventOutbox';
import { basketStockProblem, DOUBLE_ENTER_MS, exactMatch, lookupFailure, nameMatches, payFailure, stockDecision } from './counter/tillRules';
import { codeFromScan, documentNumberFromScan } from '../utils/scanLinks';
import { priceLine, summarise } from './counter/basketMath';
import { BasketSummaryFoot, BasketTable, SaleHead } from './counter/BasketTable';
import { CASH_TOLERANCE } from '../components/CashCount';
import { CountSheet, CustomerSheet, NumberSheet, PinSheet, PayPanel, type Payment, ReasonSheet, SerialSheet, UnprintedSheet, ZSheet } from './counter/CounterSheets';
import { changeFor, EMPTY_PAY, type PayDraft, splitFor } from './counter/payDraft';
import { InvoicesSheet } from './counter/InvoicesSheet';
import { DeliverSheet } from './counter/DeliverSheet';
import { ProductFinder } from './counter/ProductFinder';
import { RefundSheet } from './counter/RefundSheet';
import { readScaleLabel } from './counter/scaleLabel';
import { playScanSound } from './counter/scanSound';
import { type Basket, type PendingSale, useBaskets } from './counter/useBaskets';
import { type PrintResult, type ReceiptInput, type Unprinted, useFiscalPrinter } from './counter/useFiscalPrinter';
import { newSaleKey, type QueuedSale, withTimeout } from './counter/offlineQueue';
import { useWaitingSales } from './counter/useWaitingSales';

type Panel =
  | 'find'
  | 'invoices'
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
  | 'approvePayLater'
  | 'deliver'
  | 'serial'
  | null;

/** What the till shows after a sale: the invoice, how it was paid, the change, and the printer's receipt number once it prints. */
interface LastSale {
  /** The key made at Pay. */
  key: string;
  /** 0 while a sale made offline waits to be sent. */
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
  products: number;
  pieces: number;
  /** Sold without internet: it waits on this PC to be sent. */
  offline: boolean;
}

/** A scan that went wrong, shown big over the basket until the next scan or Esc. */
interface Alarm {
  title: string;
  detail: string;
  todo: string;
  /** A way out besides Got it, such as switching to the owner. */
  action?: { label: string; run: () => void };
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Kilos are kept to the gram; pieces stay whole. */
const toGram = (amount: number) => Math.round(amount * 1000) / 1000;

const minutesSince = (time: number, now: number) => Math.max(0, Math.floor((now - time) / 60_000));

/** How long Pay waits for the server before the sale waits on the PC instead. */
const PAY_TIMEOUT_MS = 12_000;
/** How long a scan waits for the server to look up a code this PC's shelf doesn't know. */
const LOOKUP_TIMEOUT_MS = 5_000;
/** How long one batch of till events may take before it counts as no internet (and is tried again later). */
const EVENTS_TIMEOUT_MS = 15_000;
/** The keys that change what a basket sells, closed while its sale waits for an answer. */
const CHANGES_BASKET = new Set<Panel>(['quantity', 'price', 'discount', 'basketRabat', 'customer', 'remove', 'cancel', 'deliver', 'serial', 'find']);

/** Whether the browser says it is connected, kept up to date. */
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
  const connected = useOnline();
  // Connected but the server didn't answer (Wi-Fi up, internet down): the Counter works as offline until it answers again.
  const [unreachable, setUnreachable] = useState(false);
  const online = connected && !unreachable;

  const products = useQuery({ queryKey: ['products', 'counter-shelf'], queryFn: counterApi.products, staleTime: 60_000 });
  const settings = useQuery({ queryKey: ['counter', 'settings'], queryFn: counterApi.settings });
  const shopSettings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  // Whether anyone may sell past what 4VD thinks is on the shelf; refused until the rule is known.
  const shopRules = useQuery({ queryKey: ['settings', 'rules'], queryFn: settingsApi.rules, staleTime: 60_000 });
  const noStockRule = shopRules.data?.noStockSales ?? 'block';
  // The Z report's header shows the business's own name (4VD's own business: 4VD).
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const today = useQuery({ queryKey: ['counter', 'today'], queryFn: counterApi.today });
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });
  // The shop drawer today: its opening cash and whether it was counted (never what 4VD expects).
  const cash = useQuery({ queryKey: ['cash', 'today'], queryFn: cashApi.today });
  const shopDrawer = cash.data?.find((drawer) => drawer.place === 'shop') ?? null;
  const needsOpening = shopDrawer !== null && shopDrawer.opening === null && shopDrawer.countedAt === null;
  const expiries = useQuery({ queryKey: ['expiry', 'upcoming'], queryFn: () => expiryApi.upcoming(), staleTime: 5 * 60_000 });
  const shortDatedBatches = useQuery({ queryKey: ['expiry', 'short-dated'], queryFn: expiryApi.shortDated, staleTime: 5 * 60_000 });
  const offers = useMemo(() => offersByProduct(shortDatedBatches.data), [shortDatedBatches.data]);
  const [panel, setPanelState] = useState<Panel>(null);
  // A sale on its way to the server: nothing opens over Pay or takes its place (Back, Esc, Not printed, a scan) until it is settled.
  const payingRef = useRef(false);
  const [paying, setPaying] = useState(false);
  const setPayingNow = (on: boolean) => {
    payingRef.current = on;
    setPaying(on);
  };
  const setPanel = useCallback((next: Panel) => {
    if (!payingRef.current) setPanelState(next);
  }, []);
  // Products that have serial numbers (Settings → Features): the sale asks for one per unit.
  const features = useFeatures();
  const serialProducts = useQuery({ queryKey: ['serials', 'products'], queryFn: serialsApi.products, enabled: features.serials, staleTime: 60_000 });
  const [serialFor, setSerialFor] = useState<number | null>(null);
  const printer = useFiscalPrinter(settings.data?.printer.enabled ?? false, t.counter);
  const { baskets, current, setLines, update: updateBasket, setPending, open: openBasket, select: selectBasket, close: closeBasket } = useBaskets(user.id);

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
  const customer = current.customerId ? (customers.data?.find((one) => one.id === current.customerId) ?? null) : null;
  // Wholesale prices: what the customer pays, unless the owner's side switched this basket.
  const wholesaleOf = (basket: Basket) => basket.wholesale ?? customers.data?.find((one) => one.id === basket.customerId)?.paysWholesale ?? false;
  const wholesale = wholesaleOf(current);
  // A tapped batch that is no longer short-dated (sold out, or past its date) drops off the line.
  const lines = current.lines.map((line) =>
    priceLine(line.shortDated && offers.get(line.productId)?.id !== line.shortDated.id ? { ...line, shortDated: undefined } : line, byId.get(line.productId), basketRabat, wholesale),
  );
  const summary = summarise(lines);
  const total = summary.total;

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
  // An owner's yes needs the server, so not offline.
  const canAsk = !canOversee(user.role) && online;
  const switchPeople = useQuery({ queryKey: ['counter', 'pin-people', user.id], queryFn: () => counterApi.pinPeople(false), enabled: panel === 'switch' });
  const approvers = useQuery({ queryKey: ['counter', 'approvers', user.id], queryFn: () => counterApi.pinPeople(true), enabled: panel === 'approve' || panel === 'approvePayLater' });
  // A customer waiting for the owner's yes to pay later.
  const [askLater, setAskLater] = useState<Customer | null>(null);

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

  // Never in the way of the sale: each event is written to this PC first, then sent in order; without internet it waits.
  // The business comes a moment after a Switch person (the Counter stays in its business): keep the last one known meanwhile.
  const lastBusiness = useRef(user.businessId);
  if (user.businessId !== undefined) lastBusiness.current = user.businessId;
  const businessId = user.businessId ?? lastBusiness.current ?? 0;
  const owner = useMemo<Owner>(() => ({ businessId, userId: user.id }), [businessId, user.id]);
  // Who is at the till right now: a send that started for someone else stops before its next request.
  const ownerNow = useRef(owner);
  ownerNow.current = owner;
  const [refusedEvents, setRefusedEvents] = useState(() => refusedEntries(localEventStore, owner));
  const sendEvents = useCallback(
    () =>
      drain(
        localEventStore,
        owner,
        // A request that hangs counts as no internet, so it never holds the rest (or Switch person) up.
        (events) => withTimeout(counterApi.record(events), EVENTS_TIMEOUT_MS),
        () => ownerNow.current === owner,
      )
        .catch(() => undefined)
        .finally(() => setRefusedEvents(refusedEntries(localEventStore, owner))),
    [owner],
  );
  const record = useCallback(
    (events: CounterEventInput[]) => {
      keep(localEventStore, owner, events);
      return sendEvents();
    },
    [owner, sendEvents],
  );
  const sendRefusedAgain = () => {
    unrefuse(localEventStore, owner);
    void sendEvents();
  };
  // What waits goes as soon as the internet is there, and again every half minute while it is.
  useEffect(() => {
    if (!connected) return;
    void sendEvents();
    const timer = window.setInterval(() => void sendEvents(), 30_000);
    return () => window.clearInterval(timer);
  }, [connected, sendEvents]);

  /** The beep or the buzz after a scan, unless Settings → Counter turned them off. */
  const sound = (kind: 'ok' | 'fail') => {
    if (settings.data?.scanSounds !== false) playScanSound(kind);
  };

  // A product refused past stock, put in once an owner or admin takes over the till.
  // Only for a couple of minutes: a switch much later, for something else, adds nothing.
  // Bound to the basket and the line as they were refused: anything changed in between, and nothing goes in.
  const [afterSwitch, setAfterSwitch] = useState<{ basketId: string; productId: number; from: number; to: number; until: number } | null>(null);
  // Set once the owner's PIN went through, so closing the PIN sheet afterwards keeps what waits for them.
  const switchDone = useRef(false);

  /**
   * Past stock with the shop's rule against it: the big alarm, with the
   * owner's way through when they can take over. `wanted` is what the line
   * should hold, `inBasket` what it holds now.
   */
  function refuseStock(product: Product, wanted: number, inBasket: number) {
    const stock = product.stock.quantity;
    const text = stock <= 0 ? t.counter.outOfStock(product.name) : t.counter.noMore(product.name, stock);
    const basketId = current.id;
    alarmFor(text, {
      title: stock <= 0 ? t.counter.alarm.outOfStock : t.counter.alarm.noMore,
      detail: text,
      todo: online ? t.counter.alarm.blockedTodo : t.counter.alarm.blockedOfflineTodo,
      action: online
        ? {
            label: t.counter.alarm.switchToOwner,
            run: () => {
              switchDone.current = false;
              setAfterSwitch(wanted > inBasket ? { basketId, productId: product.id, from: inBasket, to: toGram(wanted), until: Date.now() + 2 * 60_000 } : null);
              startPanel('switch');
            },
          }
        : undefined,
    });
  }

  /**
   * Put one or more of a product in the basket. Past what 4VD thinks is on the
   * shelf it goes in with a word to count it, unless the shop refuses that and
   * an employee is selling. False when not all of them went in.
   */
  function add(product: Product, quantity = 1): boolean {
    if (current.pending) {
      complain(t.counter.pendingLocked);
      return false;
    }
    const already = current.lines.find((line) => line.productId === product.id)?.quantity ?? 0;
    const stock = product.stock.quantity;
    const decision = stockDecision({ stock, already, wanted: already + quantity, rule: noStockRule, oversees: canOversee(user.role) });
    if (decision.kind === 'refused' && decision.quantity <= already) {
      refuseStock(product, already + quantity, already);
      return false;
    }
    const next = decision.quantity;
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
    if (decision.kind === 'refused') {
      refuseStock(product, already + quantity, next);
      return false;
    }
    setAlarm(null);
    setProblem(null);
    setNotice(decision.kind === 'past' ? t.counter.pastStock(product.name, stock) : null);
    return true;
  }

  // The owner took over after a refusal: what was refused goes in now, if the basket and its line are still as they were.
  useEffect(() => {
    if (!afterSwitch) return;
    setAfterSwitch(null);
    const product = byId.get(afterSwitch.productId);
    const line = current.lines.find((one) => one.productId === afterSwitch.productId)?.quantity ?? 0;
    if (!canOversee(user.role) || !product || Date.now() >= afterSwitch.until || current.id !== afterSwitch.basketId || line !== afterSwitch.from) return;
    if (line === 0) add(product, afterSwitch.to);
    else setQuantity(product.id, afterSwitch.to);
    // Runs once per person at the till; add() and setQuantity() read the latest basket themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

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

  // "Sell it at the Counter" on an offer opens ?offer=<id>: its lines at the offered prices, in a basket of their own.
  const offerId = Number(params.get('offer'));
  const offersTaken = useRef(new Set<number>());
  useEffect(() => {
    if (!offerId || !products.data || offersTaken.current.has(offerId)) return;
    offersTaken.current.add(offerId);
    setParams({}, { replace: true });
    // Clearing ?offer= runs this again with no id, so the answer is not thrown away on cleanup.
    void offersApi.get(offerId).then(
      (offer) => {
        if (offer.status !== 'open') return complain(t.counter.offerGone(offer.number));
        if (current.lines.length > 0 && !openBasket()) return complain(t.counter.fullBaskets);
        setLines(() => offer.lines.map((line) => ({ productId: line.productId, name: line.productName, quantity: line.quantity, discount: '', offerPrice: line.unitPrice })));
        updateBasket({ customerId: offer.customer?.id ?? null, offerId: offer.id, offerNumber: offer.number, discount: '' });
        setLastSale(null);
        say(t.counter.offerLoaded(offer.number));
      },
      (error: unknown) => complain(errorMessage(error)),
    );
    // Runs once per ?offer=; the basket functions read the latest state themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId, products.data]);

  /** Whether a scan names a product on this PC's shelf, read the way the scan box reads it (links, scale labels). */
  function isShelfCode(raw: string): boolean {
    const code = codeFromScan(raw);
    if (!code) return false;
    const shelf = products.data ?? [];
    if (exactMatch(code, shelf)) return true;
    const label = readScaleLabel(code);
    return Boolean(label) && shelf.some((product) => product.unit === 'kg' && (product.scalePlu === label!.plu || (product.scalePlu === null && product.sku === String(label!.plu))));
  }

  // The till as it is now, for a scan whose answer comes from the server a moment later.
  const live = useRef({ basketId: current.id, panel, add, showCheck, priceCheck, complain, alarmFor, sound });
  live.current = { basketId: current.id, panel, add, showCheck, priceCheck, complain, alarmFor, sound };

  /** Enter in the scan box: a scanner always sends it after the code. "6*" first sells six. */
  async function handleScan(raw: string) {
    const multiplied = /^(\d{1,4})\s*[*xX]\s*(.+)$/.exec(raw.trim());
    const quantity = multiplied ? Math.max(1, Number(multiplied[1])) : 1;
    const code = codeFromScan(multiplied ? multiplied[2]! : raw);
    setScan('');
    setAlarm(null);
    if (!code) return;
    // A pack barcode adds the whole pack: "2*" before a pack of 6 adds 12.
    const take = (product: Product) => {
      if (priceCheck) {
        showCheck(product);
        return sound('ok');
      }
      sound(add(product, quantity * piecesFor(product, code)) ? 'ok' : 'fail');
    };
    const shelf = products.data ?? [];
    const exact = exactMatch(code, shelf);
    // A product comes first: the shop's own number format could look like a product code.
    if (exact) return take(exact);
    const documentNumber = documentNumberFromScan(code);
    if (documentNumber && !priceCheck) {
      if (!online) return complain(t.counter.offlineNoRefund);
      setRefundNumber(documentNumber);
      return setPanel('refund');
    }
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
    // A code this PC's shelf doesn't know yet (a product added since): the server's exact barcode or number comes before any name.
    let failure: ReturnType<typeof lookupFailure> = online ? 'notFound' : 'offline';
    let found: Product | null = null;
    if (online) {
      const startedIn = current.id;
      try {
        found = await withTimeout(productsApi.byCode(code), LOOKUP_TIMEOUT_MS);
      } catch (error) {
        failure = lookupFailure(error);
      }
      // The answer came late: the basket it was meant for was left, or paying started, so it goes nowhere.
      const now = live.current;
      if (now.basketId !== startedIn || now.panel === 'pay' || payingRef.current) return;
      if (found) {
        if (now.priceCheck) {
          now.showCheck(found);
          return now.sound('ok');
        }
        return now.sound(now.add(found, quantity * piecesFor(found, code)) ? 'ok' : 'fail');
      }
    }
    const now = live.current;
    // Typed words: one product by a real name goes in; digits or a couple of letters only open the finder.
    const named = nameMatches(code, shelf);
    if (named.addAtOnce) {
      if (now.priceCheck) {
        now.showCheck(named.products[0]!);
        return now.sound('ok');
      }
      return now.sound(now.add(named.products[0]!, quantity * piecesFor(named.products[0]!, code)) ? 'ok' : 'fail');
    }
    if (named.products.length > 0) {
      setFinderQuery(code);
      return setPanel('find');
    }
    if (failure === 'notFound') now.alarmFor(t.counter.notFound(code), { title: t.counter.alarm.notFound, detail: code, todo: t.counter.alarm.notFoundTodo });
    else now.alarmFor(t.counter.cantCheck(code), { title: t.counter.alarm.cantCheck, detail: code, todo: t.counter.alarm.cantCheckTodo });
    now.sound('fail');
  }

  function setQuantity(productId: number, quantity: number) {
    if (current.pending) return complain(t.counter.pendingLocked);
    const product = byId.get(productId);
    const already = current.lines.find((line) => line.productId === productId)?.quantity ?? 0;
    // Fewer is always fine, even on a line already past stock.
    const decision = product && quantity > already ? stockDecision({ stock: product.stock.quantity, already, wanted: quantity, rule: noStockRule, oversees: canOversee(user.role) }) : null;
    const capped = decision ? decision.quantity : quantity;
    // Refused: the line takes what the shelf holds, and the owner can take over for the rest.
    if (product && decision?.kind === 'refused') refuseStock(product, quantity, Math.max(already, toGram(capped)));
    if (product && decision?.kind === 'past') say(t.counter.pastStock(product.name, product.stock.quantity));
    const least = allowsParts(product?.unit) ? 0.001 : 1;
    setLines((now) => now.map((line) => (line.productId === productId ? { ...line, quantity: Math.max(least, toGram(capped)) } : line)));
  }

  function nudge(step: 1 | -1) {
    if (!selected) return;
    if (current.pending) return complain(t.counter.pendingLocked);
    if (step === -1 && selected.quantity - 1 < (allowsParts(selected.product?.unit) ? 0.001 : 1)) return setPanel('remove');
    setQuantity(selected.productId, selected.quantity + step);
  }

  function applyLineRabat(productId: number, value: number) {
    setLines((lines) => lines.map((line) => (line.productId === productId ? { ...line, discount: value > 0 ? String(roundMoney(value)) : '', priceSet: false } : line)));
  }

  /** One more stickered short-dated unit on this line; past the last, none again. */
  function tapShortDated(productId: number) {
    const offer = offers.get(productId);
    if (!offer) return;
    setLines((lines) => lines.map((line) => (line.productId === productId ? { ...line, shortDated: nextShortDated(line.shortDated, offer, line.quantity) } : line)));
  }

  function applyPrice(productId: number, percent: number) {
    setLines((lines) => lines.map((line) => (line.productId === productId ? { ...line, discount: percent > 0 ? String(percent) : '', priceSet: percent > 0 } : line)));
  }

  // ---- Paying and printing ----
  /** The basket as the server takes it. */
  const basketBody = (payment: Payment): QueuedSale['body'] => ({
    // Stickered short-dated units go as their own line, with their batch.
    items: lines.flatMap((line): QueuedSale['body']['items'] => {
      const discount = roundMoney(line.percent);
      // Serials go with the units in order: the short-dated ones first, then the rest.
      const serials = tracked.has(line.productId) ? (line.serials ?? []).slice(0, Math.ceil(line.quantity)) : [];
      const take = (from: number, count: number) => (serials.length > 0 ? { serials: serials.slice(from, from + count) } : {});
      if (line.offerPrice !== undefined) return [{ productId: line.productId, quantity: line.quantity, offerPrice: line.offerPrice, ...take(0, line.quantity) }];
      const rabat = discount > 0 ? { discountPercent: discount } : {};
      const rest = roundMoney(line.quantity - line.shortQuantity);
      const shortCount = line.shortQuantity > 0 && line.shortDated ? line.shortQuantity : 0;
      return [
        ...(shortCount > 0 && line.shortDated ? [{ productId: line.productId, quantity: line.shortQuantity, shortDatedId: line.shortDated.id, ...rabat, ...take(0, shortCount) }] : []),
        ...(rest > 0 ? [{ productId: line.productId, quantity: rest, ...rabat, ...take(shortCount, rest) }] : []),
      ];
    }),
    notes: null,
    // Always said, so the server charges what the Counter showed.
    wholesale,
    ...(current.offerId && { offerId: current.offerId }),
    ...(current.delivery && { delivery: current.delivery }),
    ...(payment.paidBy === 'tab' && payment.dueDate && { dueDate: payment.dueDate }),
    ...(payment.paidBy === 'tab' && current.payLater && current.payLater.customerId === payment.customerId && { payLaterApproval: current.payLater.token }),
    ...(payment.paidBy === 'card' && { paidBy: 'card' as const }),
    ...(payment.paidBy === 'split' && payment.cardAmount !== null && { cardAmount: payment.cardAmount }),
    ...(approval && lines.some((line) => roundMoney(line.percent) > discountLimit) && { rabatApproval: approval.token }),
    ...(payment.paidBy === 'tab' && payment.customerId !== null && { customerId: payment.customerId, paidNow: false }),
    // A customer picked with F5 who pays now: the sale goes on their record, not their tab.
    ...(payment.paidBy !== 'tab' && current.customerId && { customerId: current.customerId, paidNow: true }),
  });

  const refreshAfterSale = () => {
    for (const key of ['sales', 'inventory', 'products', 'analytics', 'notifications', 'reports', 'activity', 'customers', 'cash', 'documents', 'money', 'expiry']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    void today.refetch();
  };

  const setReached = useCallback((ok: boolean) => setUnreachable(!ok), []);
  // While the server can't be reached and nothing waits to be sent, ask it every half minute whether it is back.
  useEffect(() => {
    if (!unreachable || !connected) return;
    const timer = window.setInterval(() => {
      void counterApi.today().then(
        () => setUnreachable(false),
        () => undefined,
      );
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [unreachable, connected]);

  // Sales made without internet: sent once it is back, each keeping the receipt that printed for it.
  const waiting = useWaitingSales(connected, user.id, businessId, setReached, (sent) => {
    for (const { sale, result } of sent) {
      if (sale.receipt?.printed && sale.receipt.fiscalNo) void documentsApi.setFiscalReceipt(result.invoice.id, sale.receipt.fiscalNo).catch(() => undefined);
      if (sale.receipt && !sale.receipt.printed) {
        printer.keepUnprinted({ documentId: result.invoice.id, number: result.invoice.number, total: result.total, at: sale.at, text: sale.receipt.text, reason: sale.receipt.reason, job: sale.receipt.job });
        void record([{ kind: 'print_failed', documentId: result.invoice.id, reason: sale.receipt.reason.slice(0, 200) }]);
      }
      setLastSale((last) => (last?.key === sale.key ? { ...last, documentId: result.invoice.id, number: result.invoice.number } : last));
    }
    refreshAfterSale();
  });

  // One sale at a time: Back, Esc, Not printed, the basket tabs and Switch person wait until the server answered or the sale is kept on this PC.
  async function pay(payment: Payment) {
    if (payingRef.current) return;
    setPayingNow(true);
    try {
      await recordSale(payment);
    } catch (error) {
      // Recorded sales free the till themselves before printing; this is only for a sale that failed.
      setPayingNow(false);
      throw error;
    }
  }

  // A basket whose Send it again got no clear answer either: the way to look it up, and the owner's way out.
  const [stuck, setStuck] = useState<string | null>(null);
  const [forgetAsk, setForgetAsk] = useState(false);
  const pendingHere = (pending: PendingSale | undefined) => pending !== undefined && pending.userId === user.id && pending.businessId === businessId;

  /** A sale sent before without an answer: exactly that sale again, only by who made it, where they made it. */
  function sendAgain() {
    const pending = current.pending;
    if (!pending || payingRef.current) return;
    if (!pendingHere(pending)) return complain(t.counter.pendingOther);
    // Already waiting on this PC (the page closed while it was being put there): it goes from there, once.
    if (waiting.has(pending.key)) {
      closeBasket(current.id);
      return say(t.counter.soldOffline(formatMoney(pending.total)));
    }
    void pay(pending.payment).catch((error: unknown) => complain(errorMessage(error)));
  }

  /** The owner looked in Sales and the sale isn't there (or is): this basket's waiting sale is let go, and the basket is free again. */
  function forgetPending() {
    if (!current.pending || !canOversee(user.role)) return;
    setPending(current.id, null);
    setStuck(null);
    setForgetAsk(false);
    say(t.counter.forgotten);
  }

  async function recordSale(chosen: Payment) {
    const basketId = current.id;
    const again = current.pending !== undefined;
    if (current.pending && !pendingHere(current.pending)) throw new Error(t.counter.pendingOther);
    if (!again) {
      // The shop's stock rule at the very moment of Record sale (the shelf may have changed while Pay was open).
      const stockNow = basketStockProblem(lines, noStockRule, canOversee(user.role));
      if (stockNow) throw new Error(stockNow.kind === 'unknown' ? t.counter.stockUnknown(stockNow.name) : t.counter.noMore(stockNow.product.name, stockNow.product.stock.quantity));
    }
    // Sent before without an answer: the same sale, key and payment again, whatever the screen says now.
    const attempt: PendingSale = current.pending ?? {
      key: newSaleKey(),
      businessId,
      userId: user.id,
      payment: chosen,
      body: basketBody(chosen),
      total,
      at: new Date().toISOString(),
    };
    const { key, body, payment, at } = attempt;
    // Send it again tries as soon as the browser has a connection, not only after the half-minute check says 4VD is back.
    const reachable = again ? connected : online;
    if (payment.paidBy === 'tab' && !reachable) throw new Error(t.counter.offlineNoTab);
    if (current.delivery && !reachable) throw new Error(t.counter.offlineNoDelivery);
    // Written to this PC before it goes, so a lost answer or a reload sends this very sale again, recorded once.
    // If this PC can't keep it, it isn't sent at all.
    if (!again && !setPending(basketId, attempt)) {
      setPending(basketId, null);
      throw new Error(t.counter.cantKeepSale);
    }
    const delivered = current.delivery ?? null;
    let result: Awaited<ReturnType<typeof salesApi.recordBasket>> | null = null;
    // It may have gone in: the basket stays as sent until Send it again gets an answer.
    const keepWaiting = (message: string) => {
      setPayingNow(false);
      setPanelState(null);
      if (again) setStuck(basketId);
      complain(message);
      focusScan();
    };
    if (reachable) {
      try {
        // Straight to the server: a query-library mutation would pause, not fail, when the browser says offline.
        result = await withTimeout(salesApi.recordBasket({ ...body, clientKey: key }), PAY_TIMEOUT_MS);
        setUnreachable(false);
      } catch (error) {
        const failure = payFailure(error, again);
        // The sale itself was refused: nothing was recorded (a key the server knows gets its first answer back), so the basket is free again.
        if (failure === 'refused') {
          setPending(basketId, null);
          setStuck(null);
          throw error;
        }
        if (failure === 'offline') setUnreachable(true);
        // A tab, a delivery or a server that broke mid-way can't wait on this PC.
        if (failure === 'unclear' || payment.paidBy === 'tab' || delivered) return keepWaiting(t.counter.unclearPay);
        // The internet went just now: the sale waits like any other made offline, with the same key.
      }
    }
    // Offline: on this PC first; if it can't be kept there, nothing is shown as paid and the basket stays as sent.
    if (!result && !waiting.add({ key, at, userId: user.id, businessId, body, total: attempt.total, receipt: null })) return keepWaiting(t.counter.cantKeepSale);
    const sold = result
      ? { total: result.total, documentId: result.invoice.id, number: result.invoice.number }
      : { total: attempt.total, documentId: 0, number: t.counter.waitingToSend };
    if (result) {
      refreshAfterSale();
      if (delivered) void queryClient.invalidateQueries({ queryKey: TO_DELIVER_KEY });
      if (current.offerId) void queryClient.invalidateQueries({ queryKey: ['offers'] });
    } else {
      // This PC's shelf loses what was sold, so the next basket can't sell it again.
      const soldNow = new Map(lines.map((line) => [line.productId, line.quantity]));
      queryClient.setQueryData<Product[]>(['products', 'counter-shelf'], (shelf) =>
        shelf?.map((product) => {
          const gone = soldNow.get(product.id);
          return gone === undefined ? product : { ...product, stock: { ...product.stock, quantity: Math.max(0, toGram(product.stock.quantity - gone)) } };
        }),
      );
    }
    const receiptLines = result
      ? result.sales.map((sale) => {
          const product = byId.get(sale.productId);
          return { product: { id: sale.productId, sku: product?.sku ?? null, name: sale.productName, vatRate: product?.vatRate ?? 18 }, unitPrice: sale.pricePerUnit, quantity: sale.quantity };
        })
      : lines.flatMap((line) => {
          const product = { id: line.productId, sku: line.product?.sku ?? null, name: line.product?.name ?? line.name, vatRate: line.product?.vatRate ?? 18 };
          const rest = roundMoney(line.quantity - line.shortQuantity);
          return [
            ...(line.shortQuantity > 0 && line.shortUnitPrice !== null ? [{ product, unitPrice: line.shortUnitPrice, quantity: line.shortQuantity }] : []),
            ...(rest > 0 ? [{ product, unitPrice: line.unitPrice, quantity: rest }] : []),
          ];
        });
    closeBasket(basketId);
    setPanelState(null);
    // Recorded (or waiting on this PC): the till is free again while the receipt prints.
    setPayingNow(false);
    setSelectedId(null);
    setFlash(null);
    const card = payment.paidBy === 'split' ? (payment.cardAmount ?? 0) : 0;
    const change = payment.tendered !== null ? roundMoney(payment.tendered - (sold.total - card)) : null;
    const buyer = payment.paidBy === 'tab' ? customers.data?.find((one) => one.id === payment.customerId) : customer;
    say(result ? t.counter.sold(formatMoney(sold.total), sold.number) : t.counter.soldOffline(formatMoney(sold.total)));
    display(change !== null && change > 0 ? displayFor.change(change) : displayFor.thanks(sold.total));
    // Like a tab, a sale paid at the door prints no receipt here: the money isn't all in yet.
    const willPrint = settings.data?.printer.enabled === true && payment.paidBy !== 'tab' && delivered?.payment !== 'door';
    setLastSale({
      key,
      documentId: sold.documentId,
      number: sold.number,
      total: sold.total,
      paidBy: payment.paidBy,
      tendered: payment.tendered,
      change,
      cardAmount: payment.paidBy === 'split' ? card : null,
      customerName: buyer?.name ?? null,
      print: willPrint ? 'printing' : 'none',
      fiscalNo: null,
      products: summary.products,
      pieces: summary.pieces,
      offline: !result,
    });
    focusScan();
    if (!willPrint || !settings.data) {
      if (!result) waiting.printed(key, null);
      return;
    }

    // Kept with a receipt that doesn't print, so Print again can build it once more.
    const job: ReceiptInput = {
      lines: receiptLines,
      // Card and Cash + card print as cash, as the shop's receipts always have; the printer's change is the cash change.
      payment: payment.paidBy === 'card' ? { by: 'card' } : { by: 'cash', tendered: payment.tendered === null ? null : roundMoney(payment.tendered + card) },
    };
    let text: string;
    try {
      text = buildReceipt(job);
    } catch (error) {
      const reason = receiptProblem(error);
      if (result) return printFailed({ documentId: result.invoice.id, number: result.invoice.number, total: result.total, at, text: '', reason, job });
      waiting.printed(key, { text: '', printed: false, fiscalNo: null, reason, job });
      return offlinePrinted(key, { ok: false, message: reason });
    }
    if (!result) {
      // Offline the fiscal receipt still prints at once; 4VD's invoice number comes when the sale is sent.
      const printed = await printer.send(`4VD-OFF-${key.slice(0, 8)}`, text);
      waiting.printed(key, { text, printed: printed.ok, fiscalNo: printed.ok ? printed.receiptNo : null, reason: printed.ok ? '' : printed.message, job });
      return offlinePrinted(key, printed);
    }
    const item: Unprinted = { documentId: result.invoice.id, number: result.invoice.number, total: result.total, at, text, reason: '', job };
    const printed = await printer.send(`4VD-${result.invoice.number}`, text);
    await afterPrint(item, printed, false);
  }

  /** How an offline sale's receipt came out, on screen (Not printed takes it once the sale is sent). */
  function offlinePrinted(key: string, printed: PrintResult) {
    setLastSale((sale) => (sale?.key === key ? { ...sale, print: printed.ok ? 'printed' : 'failed', fiscalNo: printed.ok ? printed.receiptNo : null } : sale));
    setPrintNote(
      printed.ok
        ? { ok: true, text: printed.receiptNo ? t.counter.printer.printed(printed.receiptNo) : t.counter.printer.printedNoNumber }
        : { ok: false, text: printed.message },
    );
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

  /** The printer's job for a receipt, with today's footer and tax groups. Throws when a VAT rate has no tax group. */
  function buildReceipt(job: ReceiptInput): string {
    if (!settings.data) throw new Error(t.counter.printer.unknown);
    return receiptJob({ ...job, footer: settings.data.receiptFooter, taxGroups: settings.data.printer.taxGroups });
  }
  const receiptProblem = (error: unknown) => (error instanceof MissingTaxGroup ? t.counter.printer.noTaxGroup(error.rate) : errorMessage(error));

  /** A receipt that can't go to the printer at all: say why, on screen and in Not printed. */
  function cantPrint(item: Unprinted, reason: string) {
    printer.keepUnprinted({ ...item, reason });
    setLastSale((sale) => (sale?.documentId === item.documentId ? { ...sale, print: 'failed' } : sale));
    setPrintNote({ ok: false, text: reason });
  }

  // One print per receipt at a time: Print again on the Paid screen and in Not printed can't both send it.
  const printing = useRef(new Set<number>());
  async function printAgain(item: Unprinted) {
    if (printing.current.has(item.documentId)) return;
    printing.current.add(item.documentId);
    try {
      await printOnce(item);
    } finally {
      printing.current.delete(item.documentId);
    }
  }

  async function printOnce(item: Unprinted) {
    let text = item.text;
    // Built again when it couldn't be the first time (a tax group set since, or an older 4VD kept no text).
    if (!text) {
      if (!item.job) return cantPrint(item, t.counter.noReceiptKept);
      try {
        text = buildReceipt(item.job);
      } catch (error) {
        return cantPrint(item, receiptProblem(error));
      }
    }
    const printed = await printer.send(`4VD-${item.number}`, text);
    await afterPrint({ ...item, text }, printed, true);
  }

  async function runReport(kind: 'x' | 'z') {
    const printed = await printer.send(kind === 'x' ? '4VD-X' : '4VD-Z', kind === 'x' ? xReportJob() : zReportJob(business.data?.brand.name ?? '4VD'));
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
  const tracked = new Set(features.serials ? (serialProducts.data ?? []).map((product) => product.productId) : []);
  const serialLine = lines.find((line) => line.productId === serialFor) ?? null;
  const missingSerial = () => lines.find((line) => tracked.has(line.productId) && (line.serials?.length ?? 0) < Math.ceil(line.quantity));
  const startPanel = (next: Panel) => {
    if (payingRef.current) return;
    setAlarm(null);
    // A sale sent without an answer: Pay sends that same sale again; nothing else may change the basket first.
    if (current.pending) {
      if (next === 'pay') return sendAgain();
      if (CHANGES_BASKET.has(next)) return complain(t.counter.pendingLocked);
    }
    if (['quantity', 'price', 'discount', 'remove'].includes(next ?? '') && !selected) return complain(t.counter.pickLine);
    if ((next === 'pay' || next === 'cancel') && !hasLines) return complain(t.counter.addFirst);
    // The shop's rule looks at the whole basket before the money is taken, online or not: lines put in by someone
    // else (an owner before a switch) or a shelf that changed since can't be sold past stock by an employee.
    if (next === 'pay') {
      const problem = basketStockProblem(lines, noStockRule, canOversee(user.role));
      if (problem?.kind === 'over') return refuseStock(problem.product, problem.quantity, problem.quantity);
      // Stock 4VD can't see (the product list didn't load): an employee can't sell past it blind.
      if (problem?.kind === 'unknown') return complain(t.counter.stockUnknown(problem.name));
    }
    // Online, each unit of a product with serial numbers needs its serial before paying; offline it can wait.
    const missing = next === 'pay' && online ? missingSerial() : undefined;
    if (missing) {
      setSerialFor(missing.productId);
      setPanel('serial');
      return;
    }
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
    if (!online) return complain(t.counter.offlineNoRefund);
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
        // While the sale is on its way, going back could let it be paid twice.
        if (!payingRef.current) closePanel();
      }
      return;
    }
    const shortcuts: Record<string, () => void> = {
      F1: () => startPanel('invoices'),
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

  // When the last scan's Enter came: a scanner that sends two (CR+LF, or a double Enter) must not open Pay.
  const lastScanEnter = useRef(Number.NEGATIVE_INFINITY);
  function handleScanKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (scan.trim() === '') {
        if (event.timeStamp - lastScanEnter.current < DOUBLE_ENTER_MS) return;
        return hasLines && !priceCheck ? startPanel('pay') : undefined;
      }
      lastScanEnter.current = event.timeStamp;
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

  // Reports and the drawer are needed once or twice a day, so they live in one menu in the bar.
  const reportsReady = keysEnabled && canPrint && printer.reach !== 'off';
  // So do the day's invoices and refunds: jobs between customers, not during a sale (F1 and F7 still open them).
  const tillItems: MenuItem[] = [
    ...(keysEnabled && online
      ? [
          { label: t.counter.invoicesKey, icon: Receipt, shortcut: 'F1', onSelect: () => startPanel('invoices') },
          { label: t.counter.refund, icon: ArrowCounterClockwise, shortcut: 'F7', onSelect: openRefund },
        ]
      : []),
    ...(reportsReady
      ? [
          { label: t.counter.xReport, icon: Printer, onSelect: () => void runReport('x') },
          { label: t.counter.zReport, icon: Printer, onSelect: () => startPanel('z') },
        ]
      : []),
    ...(keysEnabled && shopDrawer
      ? [
          { label: t.counter.openingKey, icon: Coins, onSelect: () => startPanel('opening') },
          { label: t.counter.countKey, icon: Calculator, onSelect: () => startPanel('count') },
        ]
      : []),
    ...(keysEnabled && settings.data?.drawerConnected ? [{ label: t.counter.openDrawer, icon: CashRegister, onSelect: () => startPanel('drawer') }] : []),
  ];

  return (
    <div className="counter">
      <header className="counter__bar">
        <div className="counter__brand">
          <LogoMark size={32} />
          <div>
            <h1 className="visually-hidden">{t.counter.title}</h1>
            <p className="counter__title" aria-hidden="true">
              {t.counter.title}
            </p>
            <p className="counter__who">{t.counter.signedInAs(user.name)}</p>
          </div>
        </div>
        <div className="counter-baskets" role="group" aria-label={t.counter.baskets}>
          {baskets.map((basket, index) => {
            const basketTotal = roundMoney(
              basket.lines.reduce((sum, line) => {
                const product = byId.get(line.productId);
                const percent = parsePercent(line.discount) || parsePercent(basket.discount ?? '');
                if (line.offerPrice !== undefined) return sum + line.offerPrice * line.quantity;
                return sum + (product ? afterDiscount(unitPriceFor(product, line.quantity, wholesaleOf(basket)), percent) * line.quantity : 0);
              }, 0),
            );
            const minutes = minutesSince(basket.startedAt, now);
            return (
              <button
                key={basket.id}
                type="button"
                className="counter-basket"
                aria-pressed={basket.id === current.id}
                disabled={paying}
                onClick={() => {
                  selectBasket(basket.id);
                  setSelectedId(null);
                  focusScan();
                }}
              >
                <span className="counter-basket__head">
                  <span className="counter-basket__name">{t.counter.basketTab(index + 1)}</span>
                  <span className="counter-basket__total">{basket.lines.length > 0 ? <RollingNumber value={formatMoney(basketTotal)} /> : t.counter.basketEmpty}</span>
                </span>
                <span className="counter-basket__meta">
                  {/* An empty basket has no sale yet, so no age either. */}
                  {basket.lines.length > 0 ? `${t.counter.basketLines(basket.lines.length)} · ${t.counter.age(minutes)}` : t.counter.basketReady}
                </span>
              </button>
            );
          })}
          <Button size="sm" variant="ghost" icon={Plus} onClick={newBasket} disabled={paying} title="F8" aria-keyshortcuts="F8">
            {t.counter.newBasket}
          </Button>
        </div>
        <div className="counter__status">
          {/* The two things the till depends on, side by side: the internet and the printer. */}
          <p
            className={online ? (waiting.waiting.length > 0 ? 'counter-printer counter-printer--warn' : 'counter-printer counter-printer--ok') : 'counter-printer counter-printer--danger'}
            role="status"
          >
            {online ? <WifiHigh size={16} weight="bold" aria-hidden="true" /> : <WifiSlash size={16} weight="bold" aria-hidden="true" />}
            <span>
              {online
                ? waiting.waiting.length > 0
                  ? t.counter.sending(waiting.waiting.length)
                  : t.counter.online
                : waiting.waiting.length > 0
                  ? t.counter.offlineWaiting(waiting.waiting.length)
                  : t.counter.offline}
            </span>
          </p>
          <p className={`counter-printer counter-printer--${printerTone}`} role="status" title={printerHint}>
            {printer.busy ? (
              <CircleNotch size={16} weight="bold" className="button__spinner" aria-hidden="true" />
            ) : (
              <Printer size={16} weight="bold" aria-hidden="true" />
            )}
            <span>{printer.busy ? t.counter.printer.printing : reachText[printer.reach]}</span>
          </p>
          {printer.unprinted.length > 0 && (
            <Button size="sm" variant="danger" icon={WarningCircle} disabled={paying} onClick={() => setPanel('unprinted')}>
              {t.counter.notPrinted(printer.unprinted.length)}
            </Button>
          )}
          <span className="counter__divider" aria-hidden="true" />
          {tillItems.length > 0 && <MenuButton label={t.counter.groups.till} icon={CashRegister} items={tillItems} />}
          <Button size="sm" variant="ghost" icon={UsersThree} disabled={!online || paying} onClick={() => startPanel('switch')} aria-label={t.counter.switchKey} title={t.counter.switchKey}>
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
          <time className="counter__clock" dateTime={clock} title={formatDate(clock)}>
            {formatTime(clock)}
          </time>
        </div>
      </header>

      <main className="counter__main">
        <section className="counter-till" aria-label={t.counter.title}>
          <div className="counter-toolbar">
            <div className="counter-scan">
              <label className={priceCheck ? 'counter-scan__field counter-scan__field--check' : 'counter-scan__field'}>
                <span className="counter-scan__icon" aria-hidden="true">
                  {priceCheck ? <Tag size={24} weight="bold" /> : <Barcode size={24} weight="bold" />}
                </span>
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
                {scan.trim() !== '' && pendingCount === null && (
                  <kbd className="counter-scan__enter" aria-hidden="true">
                    Enter
                  </kbd>
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

          </div>

          <div aria-live="polite" className="counter-messages">
            {priceCheck && (
              <p className="counter-message counter-message--info" role="status">
                <Tag size={16} weight="bold" aria-hidden="true" />
                {t.counter.priceCheckOn}
              </p>
            )}
            {problem && (
              <p className={alarm ? 'visually-hidden' : 'counter-message counter-message--problem'} role="alert">
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
              startedAt={current.lines.length > 0 ? formatTime(new Date(current.startedAt).toISOString()) : null}
              basketRabat={parsePercent(basketRabat)}
              offerNumber={current.offerNumber ?? null}
              delivery={current.delivery ? deliveryWhen(current.delivery) : null}
              wholesale={wholesale}
              onWholesale={canOversee(user.role) && current.offerId == null ? () => updateBasket({ wholesale: !wholesale }) : undefined}
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
                offers={offers}
                onShortDated={(productId) => {
                  tapShortDated(productId);
                  focusScan();
                }}
                onSelect={(productId) => {
                  setSelectedId(productId);
                  focusScan();
                }}
              />
            ) : lastSale ? (
              <PaidScreen
                sale={lastSale}
                unprinted={printer.unprinted.find((item) => item.documentId === lastSale.documentId) ?? null}
                onPrintAgain={(item) => {
                  setLastSale((sale) => (sale?.documentId === item.documentId ? { ...sale, print: 'printing' } : sale));
                  void printAgain(item);
                }}
              />
            ) : (
              !checked && (
                <div className="counter-empty">
                  <Barcode size={32} aria-hidden="true" className="counter-empty__icon" />
                  <p className="counter-empty__title">{t.counter.empty}</p>
                  <p className="counter-hint">{t.counter.emptyHint}</p>
                </div>
              )
            )}
            {hasLines && (
              <p className="counter-tape__keys">
                <span>
                  <kbd>↑ ↓</kbd> {t.counter.legendKeys.lines}
                </span>
                <span>
                  <kbd>+ −</kbd> {t.counter.legendKeys.nudge}
                </span>
              </p>
            )}
            {panel === 'pay' && <PaidRows draft={payDraft} total={total} customerName={customers.data?.find((one) => String(one.id) === payDraft.customerId)?.name ?? null} />}
          </div>
        </section>

        <aside className="counter-side" aria-label={t.counter.keys}>
          {panel === 'pay' ? (
            <PayPanel
              total={total}
              customers={customers.data}
              draft={payDraft}
              offline={!online}
              onChange={setPayDraft}
              onPay={pay}
              onBack={closePanel}
              canDecide={canOversee(user.role)}
              payLater={current.payLater}
              onAskOwner={(asked) => {
                setAskLater(asked);
                setPanel('approvePayLater');
              }}
              door={current.delivery?.payment === 'door' ? current.delivery : null}
              // A barcode scanned while paying: back to the basket, and the product goes in.
              isProductCode={isShelfCode}
              onScan={(code) => {
                if (payingRef.current) return;
                // A scanner that sends a second Enter must not open Pay again from the empty scan box.
                lastScanEnter.current = performance.now();
                closePanel();
                void handleScan(code);
              }}
            />
          ) : (
            <>
              {current.pending && (
                <div className="counter-opening counter-refused" role="alert">
                  <WarningCircle size={20} weight="bold" aria-hidden="true" />
                  <div className="counter-opening__text">
                    <p className="counter-opening__title">{t.counter.pendingSale(formatMoney(current.pending.total))}</p>
                    {!pendingHere(current.pending) && <p>{t.counter.pendingOther}</p>}
                    {(stuck === current.id || !pendingHere(current.pending)) && <p>{t.counter.checkSales}</p>}
                  </div>
                  <div className="counter-opening__keys">
                    {pendingHere(current.pending) && (
                      <Button size="sm" variant="primary" icon={ArrowClockwise} loading={paying} disabled={paying} onClick={sendAgain}>
                        {t.counter.sendAgain}
                      </Button>
                    )}
                    {(stuck === current.id || !pendingHere(current.pending)) && (
                      <ButtonLink size="sm" variant="ghost" icon={ArrowSquareOut} to="/sales">
                        {t.counter.openSales}
                      </ButtonLink>
                    )}
                    {canOversee(user.role) && (stuck === current.id || !pendingHere(current.pending)) &&
                      (forgetAsk ? (
                        <>
                          <Button size="sm" variant="danger" disabled={paying} onClick={forgetPending}>
                            {t.counter.forgetYes}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setForgetAsk(false)}>
                            {t.counter.keepIt}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={paying} onClick={() => setForgetAsk(true)}>
                          {t.counter.forget}
                        </Button>
                      ))}
                  </div>
                </div>
              )}
              {refusedEvents.length > 0 && (
                <div className="counter-opening counter-refused" role="alert">
                  <WarningCircle size={20} weight="bold" aria-hidden="true" />
                  <div className="counter-opening__text">
                    <p className="counter-opening__title">{t.counter.eventsRefused(refusedEvents.length)}</p>
                    <p>{refusedEvents[0]!.refused}</p>
                  </div>
                  <Button size="sm" icon={ArrowClockwise} disabled={!online} onClick={sendRefusedAgain}>
                    {t.counter.refusedRetry}
                  </Button>
                </div>
              )}
              {waiting.refused.length > 0 && (
                <div className="counter-opening counter-refused" role="alert">
                  <WarningCircle size={20} weight="bold" aria-hidden="true" />
                  <div className="counter-opening__text">
                    <p className="counter-opening__title">{t.counter.refusedTitle(waiting.refused.length)}</p>
                    <p>{waiting.refused[0]!.refused}</p>
                    <p>{t.counter.refusedHint}</p>
                  </div>
                  <Button size="sm" icon={ArrowClockwise} disabled={!online} onClick={waiting.retry}>
                    {t.counter.refusedRetry}
                  </Button>
                </div>
              )}
              {needsOpening && (
                <div className="counter-opening">
                  <Coins size={20} weight="bold" aria-hidden="true" />
                  <div className="counter-opening__text">
                    <p className="counter-opening__title">{t.counter.openingMissing}</p>
                    <p>{t.counter.openingMissingHint}</p>
                  </div>
                  <Button size="sm" variant="secondary" icon={Coins} disabled={!keysEnabled} onClick={() => startPanel('opening')}>
                    {t.counter.openingKey}
                  </Button>
                </div>
              )}
              {/* Like the foot of a receipt, right above the key that takes the money. */}
              <BasketSummaryFoot summary={summary} />
              <Button variant="primary" className="counter-pay" disabled={!hasLines} onClick={() => startPanel('pay')} title="F9 · Enter" aria-keyshortcuts="F9">
                <span>{t.counter.pay}</span>
                <span className="visually-hidden">{formatMoney(total)}</span>
                <kbd className="counter-pay__hotkey" aria-hidden="true">
                  F9
                </kbd>
              </Button>

              <KeyGroup line title={selected ? `${t.counter.groups.line} · ${selected.product?.name ?? selected.name}` : t.counter.noLine}>
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
                <CounterKey icon={Truck} label={current.delivery ? t.counter.deliveryKeyOn : t.counter.deliverKey} pressed={Boolean(current.delivery)} disabled={!keysEnabled || !hasLines || !online} onClick={() => startPanel('deliver')} />
                <CounterKey icon={X} label={t.counter.cancelBasket} disabled={!keysEnabled || !hasLines} onClick={() => startPanel('cancel')} />
              </KeyGroup>

              <div className="counter-side__foot">
                {lastSale && <LastSaleCard sale={lastSale} canOpen={canOversee(user.role)} />}
                {today.data && <ShiftCard mine={today.data.mine} cashToday={today.data.cashToday} drawer={today.data.drawer} />}
              </div>
            </>
          )}
        </aside>
      </main>


      {serialLine && (
        <SerialSheet
          open={panel === 'serial'}
          name={serialLine.product?.name ?? serialLine.name}
          total={Math.ceil(serialLine.quantity)}
          initial={serialLine.serials ?? []}
          onClose={closePanel}
          onSave={(serials) => {
            const done = serials.length >= Math.ceil(serialLine.quantity);
            setLines((now) => now.map((line) => (line.productId === serialLine.productId ? { ...line, serials } : line)));
            if (!done) return closePanel();
            // The next line that still needs serials, else on to paying.
            const next = lines.find((line) => line.productId !== serialLine.productId && tracked.has(line.productId) && (line.serials?.length ?? 0) < Math.ceil(line.quantity));
            if (next) return setSerialFor(next.productId);
            setPayDraft({ ...EMPTY_PAY, customerId: current.customerId ? String(current.customerId) : '' });
            setPanel('pay');
          }}
        />
      )}
      {selected && (
        <>
          <NumberSheet
            open={panel === 'quantity'}
            title={t.counter.setQuantity(selected.product?.name ?? selected.name)}
            label={allowsParts(selected.product?.unit) ? `${t.counter.quantity} (${unitSymbol(selected.product?.unit)})` : t.counter.quantity}
            initial={String(selected.quantity)}
            whole={!allowsParts(selected.product?.unit)}
            check={(value) => (value < (allowsParts(selected.product?.unit) ? 0.001 : 1) ? t.counter.reasonNeeded : null)}
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
            summary={`${formatQuantity(selected.quantity, selected.product?.unit)} × ${formatMoney(selected.unitPrice)} = ${formatMoney(selected.total)}`}
            reasons={['scannedTwice', 'changedMind', 'wrongProduct']}
            confirm={t.counter.confirmRemove}
            onClose={closePanel}
            onConfirm={async (reason) => {
              // The basket first: without internet the line still goes, and the owner's record of it waits on this PC.
              setLines((now) => now.filter((line) => line.productId !== selected.productId));
              setSelectedId(null);
              closePanel();
              void record([{ kind: 'line_removed', productId: selected.productId, quantity: selected.quantity, amount: selected.total, reason }]);
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
        open={panel === 'approvePayLater'}
        title={t.counter.askOwner}
        description={askLater ? t.counter.payLaterAskHint(askLater.name, formatMoney(total)) : ''}
        people={approvers.data}
        nobody={t.counter.noApprover}
        submit={t.counter.allow}
        onClose={() => {
          setAskLater(null);
          setPanel('pay');
        }}
        onSubmit={async (userId, pin) => {
          if (!askLater) return;
          const allowed = await counterApi.allowPayLater({ userId, pin, customerId: askLater.id, amount: total, basketId: current.id });
          updateBasket({ payLater: allowed });
          setAskLater(null);
          setPanel('pay');
          say(t.counter.payLaterAllowed(allowed.by, askLater.name));
        }}
      />
      <DeliverSheet
        open={panel === 'deliver'}
        total={total}
        customer={customer}
        current={current.delivery ?? null}
        onClose={closePanel}
        onSave={(delivery) => {
          updateBasket({ delivery });
          if (delivery) say(t.counter.deliverySet(delivery.name, deliveryWhen(delivery)));
          closePanel();
        }}
      />
      <PinSheet
        open={panel === 'switch'}
        title={t.counter.switchTitle}
        description={t.counter.switchHint}
        people={switchPeople.data}
        nobody={t.counter.switchNobody}
        submit={t.counter.takeOver}
        onClose={() => {
          // Closed without taking over: what waited for the owner is dropped.
          if (!switchDone.current) setAfterSwitch(null);
          switchDone.current = false;
          closePanel();
        }}
        onSubmit={async (userId, pin) => {
          // Sales made offline and the till's events go first, so each is recorded as the person who made it.
          await waiting.flush();
          await sendEvents();
          const result = await counterApi.switchTo({ userId, pin });
          switchDone.current = true;
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
          updateBasket({ customerId: picked?.id ?? null, wholesale: null });
          if (picked) say(t.counter.customerPicked(picked.name));
          closePanel();
        }}
      />
      <ReasonSheet
        open={panel === 'cancel'}
        title={t.counter.cancelTitle}
        summary={t.counter.cancelSummary(summary.products, formatMoney(total))}
        reasons={['leftWithout', 'changedMind']}
        confirm={t.counter.confirmCancel}
        onClose={closePanel}
        onConfirm={async (reason) => {
          closeBasket(current.id);
          setSelectedId(null);
          closePanel();
          void record([{ kind: 'basket_cancelled', quantity: Math.max(1, summary.pieces), amount: total, reason }]);
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
          if (priceCheck) {
            showCheck(product);
            return closePanel();
          }
          // Refused (past stock): the finder steps aside so the alarm, and the owner's way through, can be seen.
          if (!add(product)) closePanel();
        }}
      />
      <InvoicesSheet
        open={panel === 'invoices'}
        onClose={closePanel}
        online={online}
        canOpen={canOversee(user.role)}
        unprinted={printer.unprinted}
        onPrintAgain={(item) => void printAgain(item)}
        onRefund={(number) => {
          setRefundNumber(number);
          setPanel('refund');
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
function KeyGroup({ title, line, children }: { title: string; line?: boolean; children: React.ReactNode }) {
  return (
    <section className={line ? 'counter-group counter-group--line' : 'counter-group'}>
      <h2 className="counter-group__title">{title}</h2>
      <div className="counter-keys">{children}</div>
    </section>
  );
}

/**
 * The moment a sale is paid: a big tick, the change to give back as the largest
 * thing on screen, and the receipt with the printer's answer. The next scan clears it.
 */
function PaidScreen({ sale, unprinted, onPrintAgain }: { sale: LastSale; unprinted: Unprinted | null; onPrintAgain: (item: Unprinted) => void }) {
  const t = useT();
  const p = t.counter.paidScreen;
  const how =
    sale.paidBy === 'tab' && sale.customerName
      ? t.counter.onTabOf(sale.customerName)
      : sale.paidBy === 'split' && sale.cardAmount !== null
        ? p.split(formatMoney(sale.cardAmount))
        : t.counter.paidWith[sale.paidBy];
  const cashDue = roundMoney(sale.total - (sale.cardAmount ?? 0));
  return (
    <div className="counter-sold" key={sale.key}>
      <div className="counter-sold__head">
        <span className="counter-sold__tick" aria-hidden="true">
          <SuccessCheck size={44} />
        </span>
        <p className="counter-sold__title">{p.title}</p>
        <p className="counter-sold__how">
          {how} · <strong>{formatMoney(sale.total)}</strong>
        </p>
      </div>

      {sale.change !== null && sale.change > 0 ? (
        <div className="counter-sold__change">
          <p className="counter-sold__change-label">{t.counter.giveBack}</p>
          <p className="counter-sold__change-amount">
            {formatMoney(sale.change)}
          </p>
          {sale.tendered !== null && <p className="counter-sold__change-note">{p.gaveOf(formatMoney(sale.tendered), formatMoney(cashDue))}</p>}
        </div>
      ) : (
        sale.tendered !== null && <p className="counter-sold__exact">{p.exact}</p>
      )}

      <div className="counter-sold__receipt">
        <span className="counter-sold__number">{sale.number}</span>
        <span>{p.items(sale.products, sale.pieces)}</span>
        {sale.print === 'printing' && (
          <span className="counter-sold__printing">
            <CircleNotch size={14} weight="bold" className="button__spinner" aria-hidden="true" />
            {t.counter.printer.printing}
          </span>
        )}
        {sale.print === 'printed' && (
          <span className="counter-stamp">{sale.fiscalNo ? t.counter.fiscalNo(sale.fiscalNo) : t.counter.printer.printedNoNumber}</span>
        )}
        {sale.print === 'failed' && (
          <>
            <span className="counter-stamp counter-stamp--failed">{t.counter.printer.failed}</span>
            {unprinted && (
              <Button size="sm" icon={Printer} onClick={() => onPrintAgain(unprinted)}>
                {p.printAgain}
              </Button>
            )}
          </>
        )}
      </div>

      {sale.offline && <p className="counter-sold__offline">{p.offline}</p>}
      <p className="counter-sold__next">
        <Barcode size={16} aria-hidden="true" />
        {p.next}
      </p>
    </div>
  );
}

/** The sale just made: its receipt, how it was paid and the change, and whether it printed. */
function LastSaleCard({ sale, canOpen }: { sale: LastSale; canOpen: boolean }) {
  const t = useT();
  return (
    <details className="counter-card">
      <summary className="counter-card__summary">
        <span className="counter-card__title">{t.counter.lastSale}</span>
        <span className="counter-card__mono">{sale.number}</span>
        <strong>{formatMoney(sale.total)}</strong>
        <CaretDown size={14} weight="bold" aria-hidden="true" className="counter-card__caret" />
      </summary>
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
      {canOpen && sale.documentId > 0 && (
        <ButtonLink size="sm" variant="ghost" icon={ArrowSquareOut} to={`/documents/${sale.documentId}`} title={t.counter.copyHint}>
          {t.counter.openInvoice}
        </ButtonLink>
      )}
    </details>
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
    <details className="counter-card">
      <summary className="counter-card__summary">
        <span className="counter-card__title">{t.counter.shift}</span>
        <span>{t.counter.shiftReceipts(mine.receipts)}</span>
        <strong>{formatMoney(mine.total)}</strong>
        <CaretDown size={14} weight="bold" aria-hidden="true" className="counter-card__caret" />
      </summary>
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
      </dl>
      {/* The shared drawer, apart from the person's own day: sunk into the card. */}
      <div className="counter-card__drawer">
        <h3 className="counter-card__subtitle">{t.counter.drawerBoxTitle}</h3>
        <dl className="counter-card__rows">
          <div>
            <dt>{t.counter.cashToday}</dt>
            <dd>{formatMoney(cashToday)}</dd>
          </div>
          {drawer && (
            <>
              <div>
                <dt>{t.counter.openingRow}</dt>
                <dd className={drawer.opening === null ? 'counter-card__warn' : undefined}>
                  {drawer.opening === null ? t.counter.notCounted : formatMoney(drawer.opening)}
                </dd>
              </div>
              <div className="counter-card__total">
                <dt>{t.counter.shouldHold}</dt>
                <dd>{formatMoney(drawer.shouldHold)}</dd>
              </div>
            </>
          )}
        </dl>
      </div>
    </details>
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
      <div className="counter-alarm__card">
        <Badge tone="danger">{alarm.title}</Badge>
        <p className="counter-alarm__detail">{alarm.detail}</p>
        <p className="counter-alarm__todo">{alarm.todo}</p>
        {alarm.action && (
          <Button variant="primary" icon={UsersThree} onClick={alarm.action.run}>
            {alarm.action.label}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} aria-keyshortcuts="Escape">
          {t.counter.alarm.ok}
          <kbd className="counter-key__hotkey" aria-hidden="true">
            Esc
          </kbd>
        </Button>
      </div>
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

/** When a delivery goes: its day, and the window when there is one. */
function deliveryWhen(delivery: { day: string; timeFrom: string | null; timeTo: string | null }): string {
  const slot = delivery.timeFrom || delivery.timeTo ? [delivery.timeFrom, delivery.timeTo].filter(Boolean).join('–') : null;
  return [formatDate(`${delivery.day}T12:00:00`), slot].filter(Boolean).join(', ');
}
