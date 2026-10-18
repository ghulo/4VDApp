import type { CounterEventKind } from '../database/types.js';
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
}

/**
 * What the shop's printer was set up with in TREFIN: 18% in group 5 and 8%
 * in group 4 (read from its receipt files). The rest wait for someone to say.
 */
export const DEFAULT_COUNTER_SETTINGS: CounterSettings = {
  receiptFooter: 'Ju faleminderit!',
  printer: { enabled: false, taxGroups: { '18': 5, '16': null, '8': 4, '0': null } },
  drawerConnected: false,
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
  id: number;
  kind: CounterEventKind;
  user: { id: number; name: string } | null;
  product: { id: number; name: string } | null;
  quantity: number | null;
  amount: number | null;
  reason: string | null;
  document: { id: number; number: string } | null;
  at: string;
}

export interface CounterReceiptDto {
  id: number;
  number: string;
  issuedAt: string;
  total: number;
  paidBy: 'cash' | 'card' | 'tab';
  fiscalReceiptNo: string | null;
  soldBy: string | null;
  lines: Array<{ saleId: number; productId: number; productName: string; quantity: number; pricePerUnit: number; saleDate: string; returnedQuantity: number; undone: boolean }>;
}

export interface CounterTodayDto {
  lastZ: { at: string; by: string | null } | null;
  lastX: { at: string; by: string | null } | null;
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

  /** When the printer's X and Z reports last ran, so the counter can warn before a second Z. */
  async today(): Promise<CounterTodayDto> {
    const [z, x] = await Promise.all([this.counterRepository.lastReport('z_report'), this.counterRepository.lastReport('x_report')]);
    const shape = (row: typeof z) => (row ? { at: row.created_at.toISOString(), by: row.user_name } : null);
    return { lastZ: shape(z), lastX: shape(x) };
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
      paidBy: receipt.payment_method === 'card' ? 'card' : receipt.payment_method === 'account' ? 'tab' : 'cash',
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

  async events(period: { from: string; to: string; userId?: number }): Promise<CounterEventDto[]> {
    const rows = await this.counterRepository.events(period.from, period.to, this.timeZone, period.userId);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      user: row.user_id === null ? null : { id: row.user_id, name: row.user_name ?? '' },
      product: row.product_id === null ? null : { id: row.product_id, name: row.product_name ?? '' },
      quantity: row.quantity,
      amount: row.amount === null ? null : Number(row.amount),
      reason: row.reason,
      document: row.document_id === null ? null : { id: row.document_id, number: row.document_number ?? '' },
      at: row.created_at.toISOString(),
    }));
  }
}
