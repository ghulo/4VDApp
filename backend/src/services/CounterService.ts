import type { CounterEventKind, TrefinReceiptLine } from '../database/types.js';
import type { CounterRepository } from '../repositories/CounterRepository.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { CounterEventInput, CounterSettingsInput } from '../validators/counterValidators.js';

const SETTINGS_KEY = 'counter';

/** The VAT rates a product can have, as the printer's tax groups are keyed. */
export type VatRateKey = '18' | '16' | '8' | '0';

export interface CounterSettings {
  /** Printed under every fiscal receipt ("Ju faleminderit!"). */
  receiptFooter: string;
  printer: {
    /** The counter sends receipts to the fiscal printer (only from the 4VD Windows app on the PC beside it). */
    enabled: boolean;
    /** The printer's tax group for each VAT rate; null until someone sets it. */
    taxGroups: Record<VatRateKey, number | null>;
  };
  /** The drawer is plugged into the printer, so 4VD can open it. */
  drawerConnected: boolean;
  /** A beep when a scan adds a product and a low buzz when it fails. */
  scanSounds: boolean;
}

/**
 * What the shop's printer was set up with in TREFIN: 18% in group 5 and 8%
 * in group 4 (read from its receipt files). The rest wait for someone to say.
 */
export const DEFAULT_COUNTER_SETTINGS: CounterSettings = {
  receiptFooter: 'Ju faleminderit!',
  printer: { enabled: false, taxGroups: { '18': 5, '16': null, '8': 4, '0': null } },
  drawerConnected: false,
  scanSounds: true,
};

export interface CounterPersonDto {
  user: { id: number; name: string };
  sales: number;
  sold: number;
  cash: number;
  card: number;
  tab: number;
  linesRemoved: number;
  removedAmount: number;
  basketsCancelled: number;
  cancelledAmount: number;
  refunds: number;
  refunded: number;
  drawerOpens: number;
  printFailures: number;
  reprints: number;
}

export interface CounterEventDto {
  /** Below 0 for a receipt deleted in TREFIN. */
  id: number;
  kind: CounterEventKind | 'trefin_deleted';
  user: { id: number; name: string } | null;
  product: { id: number; name: string } | null;
  quantity: number | null;
  amount: number | null;
  reason: string | null;
  document: { id: number; number: string } | null;
  at: string;
  /** A receipt someone deleted in TREFIN: who (TREFIN's user name) and what it held. */
  trefin: { deletedBy: string | null; number: string | null; kind: 'receipt' | 'invoice'; soldOn: string; customer: string | null; lines: TrefinReceiptLine[] } | null;
}

export interface CounterReceiptDto {
  id: number;
  number: string;
  issuedAt: string;
  total: number;
  /** 'split': part on the card terminal (`cardAmount`), the rest cash. */
  paidBy: 'cash' | 'card' | 'tab' | 'split';
  cardAmount: number | null;
  fiscalReceiptNo: string | null;
  soldBy: string | null;
  lines: Array<{ saleId: number; productId: number; productName: string; quantity: number; pricePerUnit: number; saleDate: string; returnedQuantity: number; undone: boolean }>;
}

export interface CounterTodayDto {
  lastZ: { at: string; by: string | null } | null;
  lastX: { at: string; by: string | null } | null;
  /** The number the next receipt will most likely get (another till can take it first). */
  nextReceipt: string;
  /** What the person asking sold today, by how it was paid. */
  mine: { receipts: number; total: number; cash: number; card: number; tab: number };
  /** Cash everyone took at the till today. */
  cashToday: number;
}

/**
 * The counter on the shop PC: its settings (fiscal printer, receipt footer,
 * drawer), what happened there besides sales (lines taken off, baskets
 * cancelled, the drawer opened, receipts that didn't print, X and Z reports)
 * and the report of all of it per person.
 */
export class CounterService {
  constructor(
    private readonly counterRepository: CounterRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  async settings(): Promise<CounterSettings> {
    const stored = (await this.settingsRepository.all()).get(SETTINGS_KEY) as Partial<CounterSettings> | undefined;
    return {
      receiptFooter: stored?.receiptFooter ?? DEFAULT_COUNTER_SETTINGS.receiptFooter,
      printer: {
        enabled: stored?.printer?.enabled ?? DEFAULT_COUNTER_SETTINGS.printer.enabled,
        taxGroups: { ...DEFAULT_COUNTER_SETTINGS.printer.taxGroups, ...stored?.printer?.taxGroups },
      },
      drawerConnected: stored?.drawerConnected ?? DEFAULT_COUNTER_SETTINGS.drawerConnected,
      scanSounds: stored?.scanSounds ?? DEFAULT_COUNTER_SETTINGS.scanSounds,
    };
  }

  async updateSettings(input: CounterSettingsInput, userId: number): Promise<CounterSettings> {
    const before = await this.settings();
    await this.transactions.run(async (repos) => {
      await repos.settings.set(SETTINGS_KEY, input, userId);
      await repos.activityLog.create({
        userId,
        action: 'counter.settings_changed',
        entityType: 'settings',
        entityId: null,
        say: { key: 'counterSettingsChanged' },
        details: { from: before, to: input },
      });
    });
    return this.settings();
  }

  /** Record what happened at the counter; the drawer and the printer's reports also go in Activity. */
  async record(events: CounterEventInput[], userId: number): Promise<void> {
    await this.transactions.run(async (repos) => {
      await repos.counter.create(
        events.map((event) => ({
          kind: event.kind,
          userId,
          productId: 'productId' in event ? event.productId : null,
          quantity: 'quantity' in event ? event.quantity : null,
          amount: 'amount' in event ? roundMoney(event.amount) : null,
          reason: 'reason' in event ? event.reason : null,
          documentId: 'documentId' in event ? (event.documentId ?? null) : null,
        })),
      );
      for (const event of events) {
        if (event.kind === 'drawer_opened') {
          await repos.activityLog.create({
            userId,
            action: 'counter.drawer_opened',
            entityType: 'counter',
            entityId: null,
            say: { key: 'drawerOpened', params: { reason: event.reason } },
            details: { reason: event.reason },
          });
        }
        if (event.kind === 'x_report' || event.kind === 'z_report') {
          await repos.activityLog.create({
            userId,
            action: `counter.${event.kind}`,
            entityType: 'counter',
            entityId: null,
            say: { key: 'printerReport', params: { kind: event.kind === 'z_report' ? 'z' : 'x' } },
          });
        }
      }
    });
  }

  /**
   * The counter's day so far: when the printer's X and Z reports last ran (so
   * it can warn before a second Z), the next receipt's number, and what the
   * person at the till sold today.
   */
  async today(userId: number, now = new Date()): Promise<CounterTodayDto> {
    const day = zonedDay(now, this.timeZone);
    const year = Number(day.slice(0, 4));
    const [z, x, next, people] = await Promise.all([
      this.counterRepository.lastReport('z_report'),
      this.counterRepository.lastReport('x_report'),
      this.counterRepository.nextInvoiceNumber(year),
      this.counterRepository.people(day, day, this.timeZone),
    ]);
    const shape = (row: typeof z) => (row ? { at: row.created_at.toISOString(), by: row.user_name } : null);
    const me = people.find((row) => row.user_id === userId);
    return {
      lastZ: shape(z),
      lastX: shape(x),
      // Numbered the way DocumentService numbers invoices.
      nextReceipt: `F-${year}-${String(next).padStart(6, '0')}`,
      mine: {
        receipts: me?.sales ?? 0,
        total: Number(me?.sold ?? 0),
        cash: Number(me?.cash ?? 0),
        card: Number(me?.card ?? 0),
        tab: Number(me?.tab ?? 0),
      },
      cashToday: roundMoney(people.reduce((sum, row) => sum + Number(row.cash ?? 0), 0)),
    };
  }

  /** Today's receipts, or the one with this number (scanned from its barcode), with what is left to give back. */
  async receipts(p: { number?: string }, now = new Date()): Promise<CounterReceiptDto[]> {
    const { receipts, lines } = await this.counterRepository.receipts(
      p.number !== undefined ? { number: p.number, timeZone: this.timeZone } : { day: zonedDay(now, this.timeZone), timeZone: this.timeZone },
    );
    return receipts.map((receipt) => ({
      id: receipt.id,
      number: receipt.number,
      issuedAt: receipt.issued_at.toISOString(),
      total: Number(receipt.total),
      paidBy: receipt.payment_method === 'card' ? 'card' : receipt.payment_method === 'account' ? 'tab' : receipt.card_amount !== null ? 'split' : 'cash',
      cardAmount: receipt.card_amount === null ? null : Number(receipt.card_amount),
      fiscalReceiptNo: receipt.fiscal_receipt_no,
      soldBy: receipt.issued_by_name,
      lines: lines
        .filter((line) => line.document_id === receipt.id)
        .map((line) => ({
          saleId: line.sale_id,
          productId: line.product_id,
          productName: line.product_name,
          quantity: line.quantity,
          pricePerUnit: Number(line.price_per_unit),
          saleDate: line.sale_date.toISOString(),
          returnedQuantity: line.returned_quantity,
          undone: line.undone,
        })),
    }));
  }

  async people(period: { from: string; to: string }): Promise<CounterPersonDto[]> {
    const rows = await this.counterRepository.people(period.from, period.to, this.timeZone);
    return rows.map((row) => ({
      user: { id: row.user_id, name: row.name },
      sales: row.sales,
      sold: Number(row.sold),
      cash: Number(row.cash),
      card: Number(row.card),
      tab: Number(row.tab),
      linesRemoved: row.lines_removed,
      removedAmount: Number(row.removed_amount),
      basketsCancelled: row.baskets_cancelled,
      cancelledAmount: Number(row.cancelled_amount),
      refunds: row.refunds,
      refunded: Number(row.refunded),
      drawerOpens: row.drawer_opens,
      printFailures: row.print_failures,
      reprints: row.reprints,
    }));
  }

  async events(period: { from: string; to: string; userId?: number; source?: 'trefin' | '4vd' }): Promise<CounterEventDto[]> {
    // TREFIN's deletions have no 4VD person, so asking for one person's moments leaves them out.
    const [rows, deletions] = await Promise.all([
      period.source === 'trefin' ? [] : this.counterRepository.events(period.from, period.to, this.timeZone, period.userId),
      period.source === '4vd' || period.userId !== undefined ? [] : this.counterRepository.trefinDeletions(period.from, period.to, this.timeZone),
    ]);
    const fromTrefin: CounterEventDto[] = deletions.map((row) => ({
      id: -row.id,
      kind: 'trefin_deleted',
      user: null,
      product: null,
      quantity: null,
      amount: Number(row.total),
      reason: null,
      document: null,
      at: row.deleted_at.toISOString(),
      trefin: { deletedBy: row.deleted_by, number: row.number, kind: row.kind, soldOn: row.sold_on, customer: row.customer, lines: row.lines },
    }));
    const own: CounterEventDto[] = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      user: row.user_id === null ? null : { id: row.user_id, name: row.user_name ?? '' },
      product: row.product_id === null ? null : { id: row.product_id, name: row.product_name ?? '' },
      quantity: row.quantity,
      amount: row.amount === null ? null : Number(row.amount),
      reason: row.reason,
      document: row.document_id === null ? null : { id: row.document_id, number: row.document_number ?? '' },
      at: row.created_at.toISOString(),
      trefin: null,
    }));
    return [...own, ...fromTrefin].sort((a, b) => b.at.localeCompare(a.at));
  }
}
