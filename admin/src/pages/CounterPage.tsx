import { RollingNumber, SuccessCheck } from '../components/ui';
import { allowsParts, piecesFor, unitSymbol } from '../utils/units';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowSquareOut,
  Barcode,
  Camera,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canOversee, counterOnly } from '../auth/roles';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { useSearchParams } from 'react-router';
import { afterDiscount, parsePercent, roundMoney, unitPriceFor } from '../components/BasketForm';
import { CameraScanSheet, type ScanStatus } from '../components/CameraScanner';
import { LogoMark } from '../components/LogoMark';
import { Badge, Button, ButtonLink, MenuButton, type MenuItem, Sheet } from '../components/ui';
import { useT } from '../i18n/useT';
import { type BasketSale, businessApi, cashApi, counterApi, customersApi, documentsApi, expiryApi, offersApi, productsApi, salesApi, serialsApi, settingsApi } from '../services/api';
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
import { useTillCopy } from '../offline/useTillCopy';
import { forgetSavedMe, saveMe } from '../offline/savedCopy';
import { currentPermissions } from '../auth/permissions';
import { afterSaleRefresh, heldOff, patchShelf, shelfAfterSale, shelfGate, type TillShelf, tillShelfKey } from './counter/shelfAfterSale';
import { ScanBox } from './counter/ScanBox';
import { BasketAge, TillClock } from './counter/TillClock';
import { BasketSummaryFoot, BasketTable, SaleHead } from './counter/BasketTable';
import { CASH_TOLERANCE } from '../components/CashCount';
import { CountSheet, CustomerSheet, NumberSheet, PinSheet, PayPanel, type Payment, ReasonSheet, SerialSheet, UnprintedSheet, ZSheet } from './counter/CounterSheets';
import { basketSignature, changeFor, draftToOpen, EMPTY_PAY, type KeptPay, type PayDraft, splitFor } from './counter/payDraft';
import { InvoicesSheet } from './counter/InvoicesSheet';
import { DeliverSheet } from './counter/DeliverSheet';
import { ProductFinder } from './counter/ProductFinder';
import { RefundSheet } from './counter/RefundSheet';
import { readScaleLabel } from './counter/scaleLabel';
import { playScanSound } from './counter/scanSound';
import { type Basket, type PendingSale, useBaskets } from './counter/useBaskets';
import { type PrintResult, type ReceiptInput, type Unprinted, useFiscalPrinter } from './counter/useFiscalPrinter';
import { fiscalFailure, isNetworkFailure, localStore, newSaleKey, type QueuedSale, withTimeout } from './counter/offlineQueue';
import {
  blockedIn,
  followUpDone,
  followUpsFor,
  localSettledStore,
  markCheck,
  markInterrupted,
  noteBlocked,
  notePrinted,
  noteSettled,
  type SettledSale,
  settledSale,
  stillPrinting,
} from './counter/settledSales';
import { useWaitingSales } from './counter/useWaitingSales';
import { touchPhone } from '../utils/touchPhone';

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


/** How long Pay waits for the server before the sale waits on the PC instead. */
const PAY_TIMEOUT_MS = 12_000;
/** How often the till fetches its shelf again for stock that changed elsewhere (a sale here patches it at once). */
const SHELF_REFRESH_MS = 3 * 60_000;

/** How long a scan waits for the server to look up a code this PC's shelf doesn't know. */
const LOOKUP_TIMEOUT_MS = 5_000;
/** How long one batch of till events may take before it counts as no internet (and is tried again later). */
const EVENTS_TIMEOUT_MS = 15_000;
/** A receipt still marked printing this long after its sale was settled was cut off (the till closed): it goes to Not printed. */
const INTERRUPTED_AFTER_MS = 90_000;
/** After a reload, the Windows app may still be printing the last receipt it was given (it waits up to 25 s for the printer). */
const DESKTOP_JOB_MS = 45_000;
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
  // The business comes a moment after a Switch person (the Counter stays in its business): keep the last one known meanwhile.
  const lastBusiness = useRef(user.businessId);
  if (user.businessId !== undefined) lastBusiness.current = user.businessId;
  const businessId = user.businessId ?? lastBusiness.current ?? 0;
  // Connected but the server didn't answer (Wi-Fi up, internet down): the Counter works as offline until it answers again.
  const [unreachable, setUnreachable] = useState(false);
  const online = connected && !unreachable;

  // Patched after each sale here (shelfAfterSale), and fetched again every few minutes for what changed elsewhere (deliveries, other tills).
  // A fetch that a sale on its way may or may not count is not trusted (ShelfGate): each sale comes off it exactly once.
  const gate = shelfGate(queryClient);
  // The till's own query (no other page fills it): each fetch names the sales held off it, and the answer says which 4VD counts already.
  const shelfKey = tillShelfKey(businessId);
  const heldKeys = useRef<() => string[]>(() => []);
  const products = useQuery({
    queryKey: shelfKey,
    queryFn: (): Promise<TillShelf> =>
      gate.load(shelfKey, async () => {
        const askedAt = Date.now();
        return { ...(await counterApi.tillShelf(heldKeys.current())), askedAt };
      }),
    staleTime: 60_000,
    refetchInterval: SHELF_REFRESH_MS,
    enabled: businessId !== 0,
  });
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

  // Sales made without internet: sent once it is back, each keeping the receipt that printed for it.
  // Each one's settled note (written before it left the queue) carries what is still to do for its receipt.
  const waiting = useWaitingSales(
    connected,
    user.id,
    businessId,
    (ok) => setReached(ok),
    (sent) => {
      for (const { sale, result } of sent) {
        setLastSale((last) => (last?.key === sale.key ? { ...last, documentId: result.invoice.id, number: result.invoice.number } : last));
      }
      // In 4VD now: each stays held (sentHolds) until a shelf fetched from here on counts it, never taken off by hand as well.
      refreshAfterSale();
      void followUp();
    },
    () => complain(t.counter.queueNotSaved),
    canOversee(user.role),
    printer.lookup,
    printer.ack,
  );
  // Sales on their way from a basket (Pay pressed, no answer yet) are named too: a shelf that counts one already says so.
  // What this till needs to sell, kept on this PC; a start without internet sells from it.
  // A sent sale is let go only once the shelf saved on this PC counts it (settleShelf), so a crash never brings a sold unit back.
  useTillCopy({ businessId, userId: user.id }, products.isError, products.data !== undefined, waiting.settleShelf);
  heldKeys.current = () => [...waiting.heldKeys(), ...baskets.flatMap((basket) => (basket.pending?.businessId === businessId ? [basket.pending.key] : []))];
  // The shelf as this till sees it: 4VD's, less what the sales held on this PC took that it doesn't count yet.
  const shelf = useMemo(() => shelfAfterSale(products.data?.products, heldOff(waiting.held, products.data)), [products.data, waiting.held]);

  const discountLimit = canOversee(user.role) ? 100 : (shopSettings.data?.employeeDiscountLimit ?? 0);
  const byId = useMemo(() => new Map((shelf ?? []).map((product) => [product.id, product])), [shelf]);
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
  const [problem, setProblem] = useState<string | null>(null);
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: number; key: number } | null>(null);
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [payDraft, setPayDraft] = useState<PayDraft>(EMPTY_PAY);
  // Payments half taken when Pay was left (Back, Esc), per basket: one comes back for its basket while nothing in it changes.
  const keptPays = useRef(new Map<string, KeptPay>());
  const signatureNow = basketSignature(current, total);
  // The basket Pay was opened for, as it was then: Pay takes the money for that basket only.
  const [payFor, setPayFor] = useState<{ basketId: string; signature: string } | null>(null);
  const openPay = () => {
    setPayFor({ basketId: current.id, signature: signatureNow });
    setPayDraft(draftToOpen(keptPays.current.get(current.id) ?? null, current.id, signatureNow, { ...EMPTY_PAY, customerId: current.customerId ? String(current.customerId) : '' }));
  };
  // Pay shows only for the basket it was opened for.
  const payOpen = panel === 'pay' && payFor?.basketId === current.id;
  const [askLogOut, setAskLogOut] = useState(false);
  // On a phone the checkout sits under the lines: when Pay opens, it scrolls into view.
  const sideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (payOpen && window.matchMedia?.('(max-width: 999px)').matches) sideRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [payOpen]);
  // A kept payment goes once its basket changes or closes: changing the basket back never brings an old payment back.
  useEffect(() => {
    for (const [id, kept] of keptPays.current) {
      if (!baskets.some((basket) => basket.id === id) || (id === current.id && kept.basket !== signatureNow)) keptPays.current.delete(id);
    }
  }, [baskets, current.id, signatureNow]);
  const [printNote, setPrintNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [refundNumber, setRefundNumber] = useState<string | null>(null);
  const [finderQuery, setFinderQuery] = useState('');
  const [priceCheck, setPriceCheck] = useState(false);
  const [checked, setChecked] = useState<Product | null>(null);
  // An owner's yes on this basket raises the rabat limit until it runs out (the till looks again the moment it does).
  const [, setApprovalChecked] = useState(0);
  useEffect(() => {
    const left = current.approval ? Date.parse(current.approval.expiresAt) - Date.now() : 0;
    if (left <= 0) return;
    const timer = window.setTimeout(() => setApprovalChecked((count) => count + 1), left + 50);
    return () => window.clearTimeout(timer);
  }, [current.approval]);
  const approval = current.approval && Date.parse(current.approval.expiresAt) > Date.now() ? current.approval : null;
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

  // Back to the scan box after each step, ready for the next scan; not on a phone, where it would pop the keyboard up over the sale.
  const focusScan = useCallback(() => {
    if (!touchPhone()) scanRef.current?.focus({ preventScroll: true });
  }, []);

  // Never in the way of the sale: each event is written to this PC first, then sent in order; without internet it waits.
  const owner = useMemo<Owner>(() => ({ businessId, userId: user.id }), [businessId, user.id]);
  // Who is at the till right now: a send that started for someone else stops before its next request.
  const ownerNow = useRef(owner);
  ownerNow.current = owner;
  // The till notes 4VD refused, for whoever is at the till now: kept with whose they are, so another person or business never sees them.
  const ownerKey = `${owner.businessId}:${owner.userId}`;
  const [refusedNotes, setRefusedNotes] = useState(() => ({ owner: ownerKey, entries: refusedEntries(localEventStore, owner) }));
  useEffect(() => setRefusedNotes({ owner: `${owner.businessId}:${owner.userId}`, entries: refusedEntries(localEventStore, owner) }), [owner]);
  const refusedEvents = refusedNotes.owner === ownerKey ? refusedNotes.entries : [];
  const sendEvents = useCallback(
    () =>
      drain(
        localEventStore,
        owner,
        // A request that hangs counts as no internet (and is stopped), so it never holds the rest (or Switch person) up.
        // The server refuses them once someone else is signed in, a resend after a refreshed sign-in included.
        // (Not while the business is still unknown, just after a switch: those wait under no business, as before.)
        (events) => withTimeout((signal) => counterApi.record(events, { ...(owner.businessId > 0 && { expectOwner: owner }), signal }), EVENTS_TIMEOUT_MS),
        () => ownerNow.current === owner,
      )
        .catch(() => undefined)
        .finally(() => {
          // A round that finished after a switch says nothing about the new person's notes.
          if (ownerNow.current === owner) setRefusedNotes({ owner: `${owner.businessId}:${owner.userId}`, entries: refusedEntries(localEventStore, owner) });
        }),
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
        // An offer in a basket of its own: Pay, if open, was for the basket before.
        if (!payingRef.current) setPanelState((now) => (now === 'pay' ? null : now));
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
    const onShelf = shelf ?? [];
    if (exactMatch(code, onShelf)) return true;
    const label = readScaleLabel(code);
    return Boolean(label) && onShelf.some((product) => product.unit === 'kg' && (product.scalePlu === label!.plu || (product.scalePlu === null && product.sku === String(label!.plu))));
  }

  // The till as it is now, for a scan whose answer comes from the server a moment later.
  const live = useRef({ basketId: current.id, panel, add, showCheck, priceCheck, complain, alarmFor, sound });
  live.current = { basketId: current.id, panel, add, showCheck, priceCheck, complain, alarmFor, sound };

  /** Enter in the scan box: a scanner always sends it after the code. "6*" first sells six. */
  async function handleScan(raw: string) {
    const multiplied = /^(\d{1,4})\s*[*xX]\s*(.+)$/.exec(raw.trim());
    const quantity = multiplied ? Math.max(1, Number(multiplied[1])) : 1;
    const code = codeFromScan(multiplied ? multiplied[2]! : raw);
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
    const onShelf = shelf ?? [];
    const exact = exactMatch(code, onShelf);
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
        onShelf.find((product) => product.unit === 'kg' && product.scalePlu === label.plu) ??
        onShelf.find((product) => product.unit === 'kg' && product.scalePlu === null && product.sku === String(label.plu));
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
        found = await withTimeout(() => productsApi.byCode(code), LOOKUP_TIMEOUT_MS);
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
    const named = nameMatches(code, onShelf);
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

  // ---- The phone camera, scanning on ----
  // Each code goes the scan box's way (handleScan); what it did is read off the basket after, to show under the picture.
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraRead, setCameraRead] = useState<{ serial: number; code: string; before: Map<number, number>; done: boolean } | null>(null);
  const cameraSerial = useRef(0);
  async function scanByCamera(code: string) {
    // A price check shows its card on the till: the camera steps aside for it.
    if (priceCheck) {
      setCameraOpen(false);
      return handleScan(code);
    }
    const serial = ++cameraSerial.current;
    setCameraRead({ serial, code, before: new Map(lines.map((line) => [line.productId, line.quantity])), done: false });
    try {
      await handleScan(code);
    } finally {
      setCameraRead((read) => (read?.serial === serial ? { ...read, done: true } : read));
    }
  }
  // The scan opened something (the product finder, a refund): the camera closes so it can be used.
  useEffect(() => {
    if (panel !== null) setCameraOpen(false);
  }, [panel]);
  const cameraStatus = ((): ScanStatus | null => {
    if (!cameraRead) return null;
    if (!cameraRead.done) return { tone: 'busy', text: t.staff.camera.checking(cameraRead.code) };
    const grew = lines.find((line) => line.quantity > (cameraRead.before.get(line.productId) ?? 0));
    if (grew) return { tone: 'ok', text: t.staff.camera.added(grew.name, formatQuantity(grew.quantity, grew.product?.unit)) };
    const why = alarm ? alarm.title : problem;
    return { tone: 'fail', text: why ? `${t.staff.camera.notAdded(cameraRead.code)} · ${why}` : t.staff.camera.notAdded(cameraRead.code) };
  })();

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

  /**
   * After a sale the till doesn't wait on, nor reload, the whole shelf: it takes what was sold off its own copy, fetches
   * only its small day figures again, and marks the rest out of date for the pages that show it.
   * Without a sale (waiting sales just sent): everything the till shows is fetched again.
   */
  const refreshAfterSale = (sold?: { sale: BasketSale; basket: Basket; payment: Payment; key: string }) => {
    if (!sold) {
      for (const key of ['sales', 'inventory', 'products', 'analytics', 'notifications', 'reports', 'activity', 'customers', 'cash', 'documents', 'money', 'expiry']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      void today.refetch();
      return;
    }
    const { sale, basket, payment, key } = sold;
    const plan = afterSaleRefresh({
      tab: payment.paidBy === 'tab',
      customer: Boolean(basket.customerId),
      datedBatches: basket.lines.some((line) => Boolean(line.shortDated) || expiry.has(line.productId) || offers.has(line.productId)),
      delivery: Boolean(basket.delivery),
      offer: Boolean(basket.offerId),
    });
    for (const key of plan.stale) void queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
    for (const key of plan.refetch) void queryClient.invalidateQueries({ queryKey: key });
    // Held off the shelf until a shelf asked for from now on counts it (kept on this PC: a reload or a saved copy of the shelf
    // never shows it again). The shelf here was fetched before the sale went (ShelfGate threw away any fetch that may count it),
    // or names it when it counts it already (a copy recorded before a reload). If the hold can't be kept, the shelf here loses it instead.
    const items = sale.sales.map((one) => ({ productId: one.productId, quantity: one.quantity }));
    if (!waiting.holdSent(key, items) && !sale.again) patchShelf(queryClient, businessId, sale.sales);
    // Recorded by an earlier copy (sent before a reload): this PC's shelf may or may not count it already, so it is fetched.
    if (sale.again) void queryClient.invalidateQueries({ queryKey: shelfKey });
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


  /*
   * What is still to do for settled sales (in their notes on this PC, so a
   * restart loses nothing): a printed receipt's number goes on the invoice, a
   * receipt that didn't print (or may not have) goes to Not printed. Only the
   * signed-in person's own, in the business they are in; the rest wait for them.
   */
  const followingUp = useRef<Promise<void> | null>(null);
  const followAgain = useRef(false);
  const keepUnprintedNow = printer.keepUnprinted;
  // Fiscal numbers 4VD said not yet to (a filed month, a closed year), in this business: shown until they go on or an owner lets them go.
  const [blocked, setBlocked] = useState<SettledSale[]>(() => blockedIn(localSettledStore, businessId));
  const [forgetBlocked, setForgetBlocked] = useState(false);
  // The newest round maker (for the person at the till now): a round asked for while another runs starts once that one ends.
  const latestFollowUp = useRef<() => Promise<void>>(() => Promise.resolve());
  const followUp = useCallback((): Promise<void> => {
    if (followingUp.current) {
      followAgain.current = true;
      return followingUp.current;
    }
    // Bound to whoever this render is for: its notes, its till notes (record) and its requests are theirs only.
    const who = owner;
    const round = (async () => {
      // Yield first: a round with nothing to wait on would otherwise end before it is marked as running, and stay marked.
      await null;
      followAgain.current = false;
      try {
        if (who.businessId === 0 || ownerNow.current !== who) return;
        // Not printed first, without waiting on the internet.
        for (const sale of followUpsFor(localSettledStore, who)) {
          const reason = sale.followUp?.unprinted;
          if (reason === undefined) continue;
          const kept = keepUnprintedNow({ documentId: sale.documentId, number: sale.number, total: sale.total, at: sale.at, text: sale.text ?? '', reason, job: sale.job, businessId: sale.businessId });
          // Only once Not printed is on this PC's disk does the note let go of the receipt (and the till note go, once).
          if (!kept) continue;
          void record([{ kind: 'print_failed', documentId: sale.documentId, reason: reason.slice(0, 200) }]);
          followUpDone(localSettledStore, sale.key, 'unprinted');
        }
        for (const sale of followUpsFor(localSettledStore, who)) {
          const fiscalNo = sale.followUp?.fiscalNo;
          if (fiscalNo === undefined) continue;
          if (ownerNow.current !== who) return;
          try {
            await withTimeout((signal) => documentsApi.setFiscalReceipt(sale.documentId, fiscalNo, { expectOwner: who, signal }), EVENTS_TIMEOUT_MS);
          } catch (error) {
            const failure = fiscalFailure(error);
            // No answer about it (no internet, someone else signed in now): it waits, the round stops.
            if (failure === 'wait') return;
            // A filed month or a closed year: the number stays on this PC, with why, and is tried again (after the accountant reopens it).
            if (failure === 'blocked') {
              noteBlocked(localSettledStore, sale.key, errorMessage(error));
              continue;
            }
            // A clear no about the number itself (the invoice is gone): nothing more to do.
          }
          followUpDone(localSettledStore, sale.key, 'fiscalNo');
        }
      } finally {
        setBlocked(blockedIn(localSettledStore, who.businessId));
        followingUp.current = null;
        if (followAgain.current) {
          followAgain.current = false;
          void latestFollowUp.current();
        }
      }
    })();
    followingUp.current = round;
    return round;
  }, [owner, keepUnprintedNow, record]);
  useEffect(() => {
    latestFollowUp.current = followUp;
  }, [followUp]);
  // At the start, after a switch and when the internet is back: what an earlier session (or person) left to do.
  useEffect(() => {
    void followUp();
  }, [followUp, ownerKey, connected]);

  /** Pay's Record sale: only for the basket Pay opened with, unchanged; otherwise Pay closes and the money is taken again. */
  async function payOpened(payment: Payment) {
    if (!payFor || payFor.basketId !== current.id || payFor.signature !== signatureNow) {
      keptPays.current.delete(current.id);
      setPanel(null);
      complain(t.counter.basketChangedInPay);
      return;
    }
    return pay(payment);
  }

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

  // An older 4VD's sale an owner is removing: a second press says yes, for that very sale.
  const [removeUnplaced, setRemoveUnplaced] = useState<string | null>(null);
  // A basket whose Send it again got no clear answer either: the way to look it up, and the owner's way out.
  const [stuck, setStuck] = useState<string | null>(null);
  // Stop asked for this basket's very sale ("<basket>:<key>"): a yes never carries over to another basket or sale.
  const [forgetAsk, setForgetAsk] = useState<string | null>(null);
  const askFor = (basket: Basket) => (basket.pending ? `${basket.id}:${basket.pending.key}` : null);
  const pendingHere = (pending: PendingSale | undefined) => pending !== undefined && pending.userId === user.id && pending.businessId === businessId;

  /** Settled on this PC already (it waits in the queue, or the till noted it): the basket closes, and nothing is settled or printed again. */
  function settledHere(basketId: string, pending: PendingSale): boolean {
    const noted = settledSale(localSettledStore, pending.key);
    if (!noted && !waiting.has(pending.key)) return false;
    closeBasket(basketId);
    setStuck(null);
    say(noted && noted.documentId > 0 ? t.counter.alreadySettled(noted.number) : t.counter.soldOffline(formatMoney(pending.total)));
    return true;
  }

  // A basket still showing a sale the till settled (the page closed or crashed in between): it closes, never settled twice.
  useEffect(() => {
    for (const basket of baskets) {
      const key = basket.pending?.key;
      if (key && (localStore.read().some((sale) => sale.key === key) || settledSale(localSettledStore, key))) closeBasket(basket.id);
    }
  }, [baskets, closeBasket]);

  // Sales, baskets and notes waiting on this PC: ask the browser never to clear them to make room (it may say no).
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => false);
  }, []);

  // Receipts that were printing when the till closed: whether they came out is unknown, so they go to Not printed marked
  // "check the printer". Never one this till is printing now; after a reload, not before the Windows app is surely done with its last job.
  const printingKeys = useRef(new Set<string>());
  const loadedAt = useRef(Date.now());
  const lookupPrint = printer.lookup;
  const ackPrint = printer.ack;
  const unprintedNow = useRef(printer.unprinted);
  unprintedNow.current = printer.unprinted;
  const checkPrints = useCallback(async () => {
    // The Windows app's journal says how each receipt still marked as printing came out (it keeps it on its disk).
    const appHas = new Set<string>();
    for (const sale of stillPrinting(localSettledStore)) {
      if (printingKeys.current.has(sale.key)) continue;
      const outcome = await lookupPrint(sale.key);
      if (outcome === null || outcome.kind === 'none') continue;
      if (outcome.kind === 'printing') appHas.add(sale.key);
      else if (outcome.kind === 'unknown') {
        if (markCheck(localSettledStore, sale.key, t.counter.printInterrupted)) ackPrint(sale.key);
      } else if (notePrinted(localSettledStore, sale.key, outcome.result.ok ? { ok: true, fiscalNo: outcome.result.receiptNo } : { ok: false, reason: outcome.result.message })) ackPrint(sale.key);
    }
    // A reprint whose answer the page never got: printed after all, its number is kept and it leaves Not printed.
    for (const item of unprintedNow.current) {
      if (!item.printKey || item.businessId !== ownerNow.current.businessId || printing.current.has(item.documentId)) continue;
      const outcome = await lookupPrint(item.printKey);
      if (outcome?.kind === 'done' && outcome.result.ok) settleReprint(item, outcome.result.receiptNo);
    }
    // Where the app can't say (a browser, an older app, never noted): "check the printer" once it is surely done with its last job.
    if (Date.now() - loadedAt.current >= DESKTOP_JOB_MS) {
      markInterrupted(localSettledStore, Date.now() - INTERRUPTED_AFTER_MS, t.counter.printInterrupted, (key) => printingKeys.current.has(key) || appHas.has(key));
    }
    void followUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settleReprint is a plain function of this render
  }, [followUp, lookupPrint, ackPrint, t]);
  useEffect(() => {
    void checkPrints();
    const later = window.setTimeout(() => void checkPrints(), DESKTOP_JOB_MS);
    const timer = window.setInterval(() => void checkPrints(), 60_000);
    return () => {
      window.clearTimeout(later);
      window.clearInterval(timer);
    };
  }, [checkPrints]);

  /** A sale sent before without an answer: exactly that sale again, only by who made it, where they made it. */
  function sendAgain() {
    const pending = current.pending;
    if (!pending || payingRef.current) return;
    if (!pendingHere(pending)) return complain(t.counter.pendingOther);
    if (settledHere(current.id, pending)) return;
    void pay(pending.payment).catch((error: unknown) => complain(errorMessage(error)));
  }

  /**
   * The owner stops this basket's waiting sale. 4VD settles it under the
   * sale's key: recorded after all, it is settled here as paid; otherwise it
   * is stopped for good (a copy still on its way can never go in), and the
   * basket is free to change and be paid again.
   */
  async function forgetPending() {
    const basket = current;
    const pending = basket.pending;
    if (!pending || !canOversee(user.role) || payingRef.current || forgetAsk !== askFor(basket)) return;
    setForgetAsk(null);
    // Its key lives in the business it was made in: it is stopped only from there.
    if (pending.businessId !== businessId) return complain(t.counter.pendingOther);
    if (settledHere(basket.id, pending)) return;
    // Recorded after all, it settles here and may print: not before the till knows whether it prints.
    if (!settings.data) return complain(t.counter.settingsLoading);
    setPayingNow(true);
    let answer: Awaited<ReturnType<typeof salesApi.stopBasket>>;
    try {
      answer = await gate.sending(() => withTimeout((signal) => salesApi.stopBasket(pending.key, { expectOwner: owner, signal }), PAY_TIMEOUT_MS));
    } catch (error) {
      setPayingNow(false);
      return complain(payFailure(error) === 'offline' ? t.counter.stopNeedsAnswer : errorMessage(error));
    }
    if (answer.state === 'recorded') return settle(pending, basket, answer.sale);
    setPending(basket.id, null);
    setStuck(null);
    setPayingNow(false);
    say(t.counter.forgotten);
  }

  /** The receipt's lines as this till shows the basket (a sale not yet in 4VD). */
  const basketReceiptLines = () =>
    lines.flatMap((line) => {
      const product = { id: line.productId, sku: line.product?.sku ?? null, name: line.product?.name ?? line.name, vatRate: line.product?.vatRate ?? 18 };
      const rest = roundMoney(line.quantity - line.shortQuantity);
      return [
        ...(line.shortQuantity > 0 && line.shortUnitPrice !== null ? [{ product, unitPrice: line.shortUnitPrice, quantity: line.shortQuantity }] : []),
        ...(rest > 0 ? [{ product, unitPrice: line.unitPrice, quantity: rest }] : []),
      ];
    });

  /** The fiscal receipt's job; card and Cash + card print as cash, as the shop's receipts always have (the printer's change is the cash change). */
  const receiptFor = (payment: Payment, receiptLines: ReceiptInput['lines']): ReceiptInput => {
    const card = payment.paidBy === 'split' ? (payment.cardAmount ?? 0) : 0;
    return { lines: receiptLines, payment: payment.paidBy === 'card' ? { by: 'card' } : { by: 'cash', tendered: payment.tendered === null ? null : roundMoney(payment.tendered + card) } };
  };

  async function recordSale(chosen: Payment) {
    const basket = current;
    const basketId = basket.id;
    const again = basket.pending !== undefined;
    if (basket.pending && !pendingHere(basket.pending)) throw new Error(t.counter.pendingOther);
    if (basket.pending && settledHere(basketId, basket.pending)) {
      setPanelState(null);
      setPayingNow(false);
      return;
    }
    // Without the till's settings it can't tell whether the receipt prints: a sale made now could go with no receipt and nothing in Not printed.
    if (!settings.data) throw new Error(t.counter.settingsLoading);
    // The business isn't known yet (just after Switch person): a sale made now would belong to no business, so it waits a moment.
    if (!again && businessId === 0) throw new Error(t.counter.tillLoading);
    if (!again) {
      // The shop's stock rule at the very moment of Record sale (the shelf may have changed while Pay was open).
      const stockNow = basketStockProblem(lines, noStockRule, canOversee(user.role));
      if (stockNow) throw new Error(stockNow.kind === 'unknown' ? t.counter.stockUnknown(stockNow.name) : t.counter.noMore(stockNow.product.name, stockNow.product.stock.quantity));
    }
    // Sent before without an answer: the same sale, key and payment again, whatever the screen says now.
    const attempt: PendingSale = basket.pending ?? {
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
    if (basket.delivery && !reachable) throw new Error(t.counter.offlineNoDelivery);
    // Written to this PC before it goes, so a lost answer or a reload sends this very sale again, recorded once.
    // If this PC can't keep it, it isn't sent at all.
    if (!again && !setPending(basketId, attempt)) {
      setPending(basketId, null);
      throw new Error(t.counter.cantKeepSale);
    }
    const delivered = basket.delivery ?? null;
    let result: BasketSale | null = null;
    // It may have gone in (or waits for whoever made it): the basket stays as sent until Send it again gets an answer.
    const keepWaiting = (message: string, unclear = true) => {
      setPayingNow(false);
      setPanelState(null);
      if (again && unclear) setStuck(basketId);
      complain(message);
      focusScan();
    };
    if (reachable) {
      try {
        // Straight to the server: a query-library mutation would pause, not fail, when the browser says offline.
        // Sent for whoever made it: the server refuses it once someone else is signed in. A timeout stops the request.
        result = await gate.sending(() =>
          withTimeout(
            (signal) => salesApi.recordBasket({ ...body, clientKey: key }, { expectOwner: { businessId: attempt.businessId, userId: attempt.userId }, signal }),
            PAY_TIMEOUT_MS,
          ),
        );
        setUnreachable(false);
      } catch (error) {
        const failure = payFailure(error, again);
        // 4VD closed the sale for good: nothing was recorded and no copy of it ever will be, so the basket is free again.
        if (failure === 'refused') {
          setPending(basketId, null);
          setStuck(null);
          throw error;
        }
        if (failure === 'otherOwner') return keepWaiting(t.counter.pendingOther, false);
        if (failure === 'offline') setUnreachable(true);
        // A tab, a delivery or a server that broke mid-way can't wait on this PC.
        if (failure === 'unclear' || payment.paidBy === 'tab' || delivered) return keepWaiting(t.counter.unclearPay);
        // The internet went just now: the sale waits like any other made offline, with the same key.
      }
    }
    if (!result) {
      // Offline: on this PC first, its receipt with it (marked printing until the printer answers); if it can't be kept there,
      // nothing is shown as paid and the basket stays as sent.
      const printsHere = settings.data?.printer.enabled === true && payment.paidBy !== 'tab' && delivered?.payment !== 'door';
      const receipt = printsHere ? { text: '', printed: false, fiscalNo: null, reason: t.counter.printInterrupted, job: receiptFor(payment, basketReceiptLines()), interrupted: true } : null;
      if (!waiting.add({ key, at, userId: attempt.userId, businessId: attempt.businessId, body, total: attempt.total, receipt })) return keepWaiting(t.counter.cantKeepSale);
    }
    return settle(attempt, basket, result);
  }

  /**
   * A sale recorded (or kept on this PC to send): the basket closes, the
   * customer sees the change, and the receipt prints. The till notes it first,
   * so a reload, a crash or Send it again never settles or prints it twice.
   */
  async function settle(attempt: PendingSale, basket: Basket, result: BasketSale | null) {
    const { key, payment, at } = attempt;
    const basketId = basket.id;
    const delivered = basket.delivery ?? null;
    // Recorded by an earlier copy this till already settled: close the basket, nothing more.
    if (result?.again && settledHere(basketId, attempt)) {
      setPanelState(null);
      setPayingNow(false);
      focusScan();
      return;
    }
    const sold = result
      ? { total: result.total, documentId: result.invoice.id, number: result.invoice.number }
      : { total: attempt.total, documentId: 0, number: t.counter.waitingToSend };
    // Kept on this PC instead, the sale stays off the shelf here while it waits (waiting.held), so the next basket can't sell it again.
    if (result) refreshAfterSale({ sale: result, basket, payment, key });
    const receiptLines = result
      ? result.sales.map((sale) => {
          const product = byId.get(sale.productId);
          return { product: { id: sale.productId, sku: product?.sku ?? null, name: sale.productName, vatRate: product?.vatRate ?? 18 }, unitPrice: sale.pricePerUnit, quantity: sale.quantity };
        })
      : basketReceiptLines();
    // Kept with a receipt that doesn't print, so Print again can build it once more.
    const job = receiptFor(payment, receiptLines);
    // Like a tab, a sale paid at the door prints no receipt here: the money isn't all in yet.
    // A copy recorded earlier whose receipt printed (its fiscal number is on the invoice) isn't printed again.
    const willPrint = settings.data?.printer.enabled === true && payment.paidBy !== 'tab' && delivered?.payment !== 'door' && !result?.fiscalNo;
    // The till's note that the sale is settled, before its basket closes and before it prints (a waiting sale's is its place in the queue).
    const noted = result
      ? noteSettled(localSettledStore, {
          key,
          businessId: attempt.businessId,
          userId: attempt.userId,
          documentId: result.invoice.id,
          number: result.invoice.number,
          total: result.total,
          at,
          settledAt: Date.now(),
          print: willPrint ? 'printing' : result.fiscalNo ? 'printed' : 'none',
          ...(willPrint && { job }),
        })
      : true;
    // Recorded, but this PC can't note that its receipt is printing: nothing prints, and the basket stays as sent (on this PC's disk),
    // so once there is room Pay finishes it: 4VD gives the same sale back, and it prints then. Never printed with nothing saying so.
    if (result && willPrint && !noted) {
      setPanelState(null);
      setPayingNow(false);
      complain(t.counter.notSavedKeepBasket);
      focusScan();
      return;
    }
    const closed = closeBasket(basketId);
    keptPays.current.delete(basketId);
    setPanelState(null);
    // Recorded (or waiting on this PC): the till is free again while the receipt prints.
    setPayingNow(false);
    setSelectedId(null);
    setFlash(null);
    const card = payment.paidBy === 'split' ? (payment.cardAmount ?? 0) : 0;
    const change = payment.tendered !== null ? roundMoney(payment.tendered - (sold.total - card)) : null;
    const buyer = payment.paidBy === 'tab' ? customers.data?.find((one) => one.id === payment.customerId) : customer;
    say(result ? t.counter.sold(formatMoney(sold.total), sold.number) : t.counter.soldOffline(formatMoney(sold.total)));
    // Neither the note nor the closed basket could be written: a reload would show this sale again.
    if (!noted && !closed) complain(t.counter.notSavedHere);
    display(change !== null && change > 0 ? displayFor.change(change) : displayFor.thanks(sold.total));
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
      print: willPrint ? 'printing' : result?.fiscalNo ? 'printed' : 'none',
      fiscalNo: result?.fiscalNo ?? null,
      products: summary.products,
      pieces: summary.pieces,
      offline: !result,
    });
    focusScan();
    if (!willPrint || !settings.data) {
      if (!result) waiting.printed(key, null);
      return;
    }

    let text: string;
    try {
      text = buildReceipt(job);
    } catch (error) {
      const reason = receiptProblem(error);
      if (result) return printedOnline(attempt, { documentId: result.invoice.id, number: result.invoice.number, total: result.total, at, text: '', reason, job, businessId: attempt.businessId }, { ok: false, message: reason });
      waiting.printed(key, { text: '', printed: false, fiscalNo: null, reason, job });
      return offlinePrinted(key, { ok: false, message: reason });
    }
    if (!result) {
      // Offline the fiscal receipt still prints at once; 4VD's invoice number comes when the sale is sent.
      const printed = await printer.send(`4VD-OFF-${key.slice(0, 8)}`, text, key);
      if (waiting.printed(key, { text, printed: printed.ok, fiscalNo: printed.ok ? printed.receiptNo : null, reason: printed.ok ? '' : printed.message, job })) printer.ack(key);
      return offlinePrinted(key, printed);
    }
    const item: Unprinted = { documentId: result.invoice.id, number: result.invoice.number, total: result.total, at, text, reason: '', job, businessId: attempt.businessId };
    // Print again (Paid screen, Not printed) waits while this very receipt is with the printer.
    printing.current.add(item.documentId);
    printingKeys.current.add(key);
    let printed: PrintResult;
    try {
      printed = await printer.send(`4VD-${result.invoice.number}`, text, key);
    } finally {
      printing.current.delete(item.documentId);
      printingKeys.current.delete(key);
    }
    printedOnline(attempt, item, printed);
  }

  /**
   * How a recorded sale's receipt came out. The note says what is still to do
   * (its number onto the invoice, or Not printed), so a crash right now loses
   * neither; the follow-up does it, for the person and business that sold it.
   */
  function printedOnline(attempt: PendingSale, item: Unprinted, printed: PrintResult) {
    const noted = notePrinted(localSettledStore, attempt.key, printed.ok ? { ok: true, fiscalNo: printed.receiptNo } : { ok: false, reason: printed.message });
    // Noted here: the Windows app's journal may let its entry go in time (not noted: it keeps it, to hand the outcome over later).
    if (noted) printer.ack(attempt.key);
    if (printed.ok) {
      printer.forget(item.documentId);
      setLastSale((sale) => (sale?.documentId === item.documentId ? { ...sale, print: 'printed', fiscalNo: printed.receiptNo } : sale));
      setPrintNote({ ok: true, text: printed.receiptNo ? t.counter.printer.printed(printed.receiptNo) : t.counter.printer.printedNoNumber });
      if (!noted && printed.receiptNo) {
        const fiscalNo = printed.receiptNo;
        // The note stays as printing, so the app's journal hands this number over again later; meanwhile it is said on screen.
        void documentsApi
          .setFiscalReceipt(item.documentId, fiscalNo, { expectOwner: { businessId: attempt.businessId, userId: attempt.userId } })
          .catch(() => setPrintNote({ ok: false, text: t.counter.fiscalNotSaved(fiscalNo) }));
      }
    } else {
      setLastSale((sale) => (sale?.documentId === item.documentId ? { ...sale, print: 'failed' } : sale));
      setPrintNote({ ok: false, text: printed.message });
      if (!noted) printFailed({ ...item, reason: printed.message });
    }
    if (noted) void followUp();
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
    await settleReprint(item, printed.receiptNo);
    if (again) void record([{ kind: 'reprinted', documentId: item.documentId }]);
  }

  /**
   * A receipt from Not printed came out. Its number is noted first (for whoever
   * printed it), so neither a lost answer nor a restart drops it. If it can't
   * be noted and 4VD can't take it either, it stays in Not printed saying so:
   * Print again then asks the Windows app's journal and keeps the number without printing.
   */
  async function settleReprint(item: Unprinted, fiscalNo: string | null) {
    const noted = fiscalNo ? noteReprinted(item, fiscalNo) : true;
    setLastSale((sale) => (sale?.documentId === item.documentId ? { ...sale, print: 'printed', fiscalNo } : sale));
    setPrintNote({ ok: true, text: fiscalNo ? t.counter.printer.printed(fiscalNo) : t.counter.printer.printedNoNumber });
    if (noted) {
      if (item.printKey) printer.ack(item.printKey);
      printer.forget(item.documentId);
      void followUp();
      return;
    }
    try {
      await withTimeout((signal) => documentsApi.setFiscalReceipt(item.documentId, fiscalNo, { expectOwner: owner, signal }), EVENTS_TIMEOUT_MS);
      printer.forget(item.documentId);
    } catch {
      printer.keepUnprinted({ ...item, reason: t.counter.fiscalNotSaved(fiscalNo ?? '') });
      setPrintNote({ ok: false, text: t.counter.fiscalNotSaved(fiscalNo ?? '') });
    }
  }

  /** A reprinted receipt's number, in the sale's note (or a new one), for the person at the till in this business. False when it couldn't be written. */
  function noteReprinted(item: Unprinted, fiscalNo: string): boolean {
    const noted = localSettledStore.read().find((sale) => sale.documentId === item.documentId);
    const base = noted
      ? { key: noted.key, documentId: noted.documentId, number: noted.number, total: noted.total, at: noted.at, settledAt: noted.settledAt }
      : { key: `reprint:${item.documentId}`, documentId: item.documentId, number: item.number, total: item.total, at: item.at, settledAt: Date.now() };
    return noteSettled(localSettledStore, { ...base, businessId: owner.businessId, userId: owner.userId, print: 'printed', followUp: { fiscalNo } });
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

  /** The key a receipt's prints go to the Windows app with: its sale's (from the till's note), else one made from its invoice. */
  const printKeyFor = (item: Unprinted) => localSettledStore.read().find((sale) => sale.documentId === item.documentId)?.key ?? `reprint:${item.documentId}`;

  // One print per receipt at a time: Print again on the Paid screen and in Not printed can't both send it.
  const printing = useRef(new Set<number>());
  async function printAgain(item: Unprinted) {
    if (printing.current.has(item.documentId)) return;
    // Sold in another business: printed only from there.
    if (item.businessId !== undefined && item.businessId !== businessId) return complain(t.counter.pendingOther);
    printing.current.add(item.documentId);
    try {
      // Kept by an older 4VD without its business: printed only once 4VD says the invoice is this business's.
      if (item.businessId === undefined) {
        try {
          await documentsApi.get(item.documentId);
        } catch {
          return complain(t.counter.pendingOther);
        }
        item = { ...item, businessId };
      }
      // Its last print: the Windows app still has it (wait), or it came out after all (its number is kept, nothing prints again).
      // Asked under the key its prints go with, kept on the row or worked out the same way printOnce does: a row saved without its key is found too.
      const outcome = await printer.lookup(item.printKey ?? printKeyFor(item));
      if (outcome?.kind === 'printing') return complain(t.counter.printerHasIt);
      if (outcome?.kind === 'done' && outcome.result.ok) return void (await settleReprint(item, outcome.result.receiptNo));
      // It may have come out (the till lost track mid-print, F-Link's folder can't say): never printed again on a guess.
      // Someone looks at the printer; only an owner says none came out, and then it prints.
      let confirmed = false;
      if (outcome?.kind === 'unknown') {
        if (!canOversee(user.role)) return complain(t.counter.printer.ownerLooks);
        if (!window.confirm(t.counter.printer.reprintConfirm)) return;
        confirmed = true;
      }
      await printOnce(item, confirmed);
    } finally {
      printing.current.delete(item.documentId);
    }
  }

  async function printOnce(item: Unprinted, confirmed = false) {
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
    // Until the printer answers, Not printed says to check the printer: a reload mid-print leaves that, not the old reason.
    // The print goes with a key, so the Windows app's journal can say later how it came out.
    const printKey = item.printKey ?? printKeyFor(item);
    // Only once Not printed keeps the key on this PC's disk does it go: a result nobody could look up again could print it twice.
    if (!printer.keepUnprinted({ ...item, text, reason: t.counter.printInterrupted, printKey })) {
      setPrintNote({ ok: false, text: t.counter.printer.notKept });
      return;
    }
    const printed = await printer.send(`4VD-${item.number}`, text, printKey, confirmed);
    await afterPrint({ ...item, text, printKey }, printed, true);
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

  // Kept by an older 4VD without their business (the PC's storage is shared by every business that uses it): shown to an owner
  // only when the sale itself proves it is this business's, every product in it on this business's shelf (a product belongs to one business).
  const unplacedMine = canOversee(user.role)
    ? waiting.unplaced.filter((sale) => sale.body.items.length > 0 && sale.body.items.every((item) => byId.has(item.productId)))
    : [];
  // Receipts sold in the business the till is in. One kept by an older 4VD shows only once 4VD said its invoice is this business's (below).
  const unprintedHere = printer.unprinted.filter((item) => item.businessId === businessId);
  // Not printed rows kept by an older 4VD without their business: each is placed once 4VD shows its invoice in this business
  // (another business's is not found); until then nothing of it shows here.
  const legacyChecked = useRef(new Set<string>());
  const keepUnprintedRow = printer.keepUnprinted;
  useEffect(() => {
    if (!online || businessId === 0) return;
    for (const item of printer.unprinted) {
      const check = `${businessId}:${item.documentId}`;
      if (item.businessId !== undefined || legacyChecked.current.has(check)) continue;
      legacyChecked.current.add(check);
      documentsApi.get(item.documentId).then(
        () => void keepUnprintedRow({ ...item, businessId }),
        // No answer: asked again later. A clear no (not found here): it stays hidden in this business.
        (error: unknown) => void (isNetworkFailure(error) && legacyChecked.current.delete(check)),
      );
    }
  }, [online, businessId, printer.unprinted, keepUnprintedRow]);

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
    if (next === 'pay') openPay();
    setPanel(next);
  };
  function newBasket() {
    if (!openBasket()) return complain(t.counter.fullBaskets);
    if (panel === 'pay') setPanel(null);
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
    if (payOpen) {
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
  /** Enter in the scan box: the code goes in; on an empty box, Pay opens (unless it is a scanner's second Enter). */
  function scanEnter(code: string, timeStamp: number) {
    if (code === '') {
      if (timeStamp - lastScanEnter.current < DOUBLE_ENTER_MS) return;
      return hasLines && !priceCheck ? startPanel('pay') : undefined;
    }
    lastScanEnter.current = timeStamp;
    void handleScan(code);
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
  // Log out sits in the Till menu, last and asked first: on a phone it was a tap away from Home.
  if (counterOnly(user.role)) tillItems.push({ label: t.counter.logOut, icon: SignOut, divider: tillItems.length > 0, onSelect: () => setAskLogOut(true) });

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
            return (
              <button
                key={basket.id}
                type="button"
                className="counter-basket"
                aria-pressed={basket.id === current.id}
                disabled={paying}
                onClick={() => {
                  // Another basket: Pay (open for this one) closes, its payment kept for this basket.
                  if (basket.id !== current.id && panel === 'pay') setPanel(null);
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
                  {basket.lines.length > 0 ? <BasketAge startedAt={basket.startedAt} lineCount={basket.lines.length} /> : t.counter.basketReady}
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
          {unprintedHere.length > 0 && (
            <Button size="sm" variant="danger" icon={WarningCircle} disabled={paying} onClick={() => setPanel('unprinted')}>
              {t.counter.notPrinted(unprintedHere.length)}
            </Button>
          )}
          <span className="counter__divider" aria-hidden="true" />
          {tillItems.length > 0 && <MenuButton label={t.counter.groups.till} icon={CashRegister} items={tillItems} />}
          <Button size="sm" variant="ghost" icon={UsersThree} disabled={!online || paying} onClick={() => startPanel('switch')} aria-label={t.counter.switchKey} title={t.counter.switchKey}>
            <span className="counter__bar-label">{t.counter.switchKey}</span>
          </Button>
          {counterOnly(user.role) ? (
            <>
              {/* On a phone it shrinks to its icon, so the printer's state keeps its room. */}
              <ButtonLink size="sm" variant="ghost" icon={ArrowLeft} to="/" aria-label={t.staff.nav.home} title={t.staff.nav.home}>
                <span className="counter__bar-label">{t.staff.nav.home}</span>
              </ButtonLink>
            </>
          ) : (
            <ButtonLink size="sm" variant="ghost" icon={ArrowLeft} to="/sales">
              {t.counter.back}
            </ButtonLink>
          )}
          <TillClock />
        </div>
      </header>

      <main className="counter__main">
        <section className="counter-till" aria-label={t.counter.title}>
          <div className="counter-toolbar">
            <div className="counter-scan">
              <ScanBox
                inputRef={scanRef}
                priceCheck={priceCheck}
                onEnter={scanEnter}
                onNudge={nudge}
                onType={() => setProblem(null)}
                onPriceCheckOff={togglePriceCheck}
              />
              {/* On a phone there's no USB scanner: the camera reads the code instead. */}
              <span className="counter-scan__camera">
                <Button
                  icon={Camera}
                  aria-label={t.staff.camera.open}
                  title={t.staff.camera.open}
                  onClick={() => {
                    setCameraRead(null);
                    setCameraOpen(true);
                  }}
                />
                <CameraScanSheet open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={scanByCamera} status={cameraStatus} beep={false} />
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
                unprinted={unprintedHere.find((item) => item.documentId === lastSale.documentId) ?? null}
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
            {payOpen && <PaidRows draft={payDraft} total={total} customerName={customers.data?.find((one) => String(one.id) === payDraft.customerId)?.name ?? null} />}
          </div>
        </section>

        <aside ref={sideRef} className="counter-side" aria-label={t.counter.keys}>
          {payOpen ? (
            <PayPanel
              total={total}
              customers={customers.data}
              draft={payDraft}
              offline={!online}
              onChange={(draft) => {
                // Only ever the payment of the basket Pay was opened for.
                if (payFor?.basketId !== current.id) return;
                setPayDraft(draft);
                keptPays.current.set(payFor.basketId, { basketId: payFor.basketId, basket: payFor.signature, draft });
              }}
              onPay={payOpened}
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
                    {forgetAsk !== null && forgetAsk === askFor(current) && <p>{t.counter.forgetAsk}</p>}
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
                      (forgetAsk !== null && forgetAsk === askFor(current) ? (
                        <>
                          <Button size="sm" variant="danger" loading={paying} disabled={paying} onClick={() => void forgetPending()}>
                            {t.counter.forgetYes}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={paying} onClick={() => setForgetAsk(null)}>
                            {t.counter.keepIt}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={paying} onClick={() => setForgetAsk(askFor(current))}>
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
                  <Button
                    size="sm"
                    icon={ArrowClockwise}
                    disabled={!online}
                    onClick={() => void waiting.retry().then((answer) => answer === 'needsOwner' && complain(t.counter.retryNeedsOwner))}
                  >
                    {t.counter.refusedRetry}
                  </Button>
                </div>
              )}
              {blocked.length > 0 && (canOversee(user.role) || blocked.some((sale) => sale.userId === user.id)) && (
                <div className="counter-opening counter-refused" role="alert">
                  <WarningCircle size={20} weight="bold" aria-hidden="true" />
                  <div className="counter-opening__text">
                    <p className="counter-opening__title">{t.counter.fiscalBlockedTitle(blocked.length)}</p>
                    <p>{blocked[0]!.followUp?.blocked}</p>
                    <p>{t.counter.fiscalBlockedHint}</p>
                  </div>
                  {canOversee(user.role) && (
                    <Button
                      size="sm"
                      variant={forgetBlocked ? 'danger' : 'secondary'}
                      onClick={() => {
                        if (!forgetBlocked) return setForgetBlocked(true);
                        setForgetBlocked(false);
                        for (const sale of blocked) followUpDone(localSettledStore, sale.key, 'fiscalNo');
                        setBlocked(blockedIn(localSettledStore, businessId));
                      }}
                    >
                      {forgetBlocked ? t.counter.fiscalBlockedForgetYes : t.counter.fiscalBlockedForget}
                    </Button>
                  )}
                </div>
              )}
              {unplacedMine.length > 0 && (
                <div className="counter-opening counter-refused" role="alert">
                  <WarningCircle size={20} weight="bold" aria-hidden="true" />
                  <div className="counter-opening__text">
                    <p className="counter-opening__title">{t.counter.unplacedTitle(unplacedMine.length)}</p>
                    <p>
                      {t.counter.unplacedLine(
                        `${formatDate(unplacedMine[0]!.at)} ${formatTime(unplacedMine[0]!.at)}`,
                        formatMoney(unplacedMine[0]!.total),
                        unplacedMine[0]!.body.items.length,
                      )}
                    </p>
                    <p>{t.counter.unplacedHint}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={removeUnplaced === unplacedMine[0]!.key ? 'danger' : 'secondary'}
                    onClick={() => {
                      const key = unplacedMine[0]!.key;
                      if (removeUnplaced !== key) return setRemoveUnplaced(key);
                      setRemoveUnplaced(null);
                      waiting.discard(key);
                    }}
                  >
                    {removeUnplaced === unplacedMine[0]!.key ? t.counter.unplacedRemoveYes : t.counter.unplacedRemove}
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

      {/* A phone: the camera and the total with Pay stay at the bottom, in reach of the thumb, however long the basket. */}
      {!payOpen && (
        <div className="counter-paybar">
          <Button
            icon={Camera}
            className="counter-paybar__scan"
            onClick={() => {
              setCameraRead(null);
              setCameraOpen(true);
            }}
          >
            {t.counter.camera}
          </Button>
          <Button variant="primary" className="counter-paybar__pay" disabled={!hasLines} onClick={() => startPanel('pay')}>
            <span>{t.counter.pay}</span>
            <span className="counter-paybar__total">{formatMoney(total)}</span>
          </Button>
        </div>
      )}

      <Sheet open={askLogOut} onClose={() => setAskLogOut(false)} title={t.counter.logOutAsk} description={t.counter.logOutHint} placement="center">
        <div className="form-actions">
          <Button variant="ghost" onClick={() => setAskLogOut(false)}>
            {t.counter.logOutStay}
          </Button>
          <Button variant="danger" icon={SignOut} onClick={() => void logout()}>
            {t.counter.logOut}
          </Button>
        </div>
      </Sheet>


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
            openPay();
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
          // The PC changes hands now: the sign-in saved for a start without internet can't name the last person any more
          // (4VD ends their session). If the takeover is refused, they stay and are saved again.
          forgetSavedMe();
          let result;
          try {
            result = await counterApi.switchTo({ userId, pin });
          } catch (error) {
            if (user.businessId !== undefined) saveMe(user, currentPermissions());
            throw error;
          }
          switchDone.current = true;
          closePanel();
          await adoptSession(result, { businessId: user.businessId ?? businessId, businesses: user.businesses });
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
        danger={false}
        onClose={closePanel}
        onConfirm={async (reason) => {
          await counterApi.record([{ kind: 'drawer_opened', reason }]);
          say(t.counter.drawerOpened);
          closePanel();
        }}
      />
      <ProductFinder
        open={panel === 'find'}
        products={shelf}
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
        unprinted={unprintedHere}
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
        items={unprintedHere}
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
