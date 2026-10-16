import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { countryFromBarcode } from '../utils/barcodeCountry.js';
import { startOfDay } from '../utils/zonedDates.js';

/** What has to be typed to really import, so it can't happen by accident. */
export const IMPORT_PHRASE = 'import trefin';
/** Settings key written once the import is done, so it can't run twice. */
export const TREFIN_IMPORTED_KEY = 'trefin_imported_at';
/** TREFIN keeps every product in this one category. */
const CATEGORY = 'Të ndryshme';
/** TREFIN's stand-ins for "any supplier", "any customer" and the cash desk. */
const GENERIC_PARTNERS = new Set(['700000', '700001', '699999']);
const BATCH = 1000;
/** A cost more than this many times the selling price is a box price or a typo, not a real cost. */
const MAX_COST_TO_PRICE = 1.2;

type Row = Record<string, string>;

export interface TrefinExport {
  products: Row[];
  suppliers: Row[];
  customers: Row[];
  sales: Row[];
  duplicates: Row[];
}

export interface TrefinImportReport {
  applied: boolean;
  created: { products: number; suppliers: number; customers: number; sales: number; checkouts: number; duplicateFlags: number };
  revenue: number;
  firstSale: string | null;
  lastSale: string | null;
  /** Things worth knowing about, with how many rows each touched. */
  notes: Record<string, number>;
}

/** A small RFC 4180 reader: quoted fields, doubled quotes, commas and line breaks inside quotes, a BOM. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = (rows.shift() ?? []).map((name) => name.replace(/^﻿/, ''));
  return rows.filter((cells) => cells.length > 1).map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}

export function readTrefinExport(dir: string): TrefinExport {
  const load = (name: string) => parseCsv(fs.readFileSync(path.join(dir, `${name}.csv`), 'utf8'));
  return {
    products: load('products'),
    suppliers: load('suppliers'),
    customers: load('customers'),
    sales: load('sales'),
    duplicates: load('duplicates'),
  };
}

const money = (value: number) => Math.round(value * 100) / 100;
const num = (value: string | undefined) => (value === undefined || value.trim() === '' ? 0 : Number(value));
const clean = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
/** TREFIN fills empty ID fields with 0, 1 or ///. */
const filled = (value: string | undefined) => {
  const text = clean(value);
  return text === '' || /^[0/\\.-]+$/.test(text) || text === '1' ? null : text;
};
const nui = (value: string | undefined) => {
  const text = filled(value);
  return text && /^\d{9}$/.test(text) ? text : null;
};

/** A sale's moment: TREFIN's date and time on the shop's clock (noon when it kept no time). */
function saleMoment(day: string, time: string, timeZone: string): Date {
  const [h, m, s] = (time || '12:00:00').split(':').map(Number);
  return new Date(startOfDay(day, timeZone).getTime() + ((h ?? 12) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000);
}

function partnerNote(row: Row, balance: { label: string; value: string }, extra: string[] = []): string | null {
  const lines = [
    clean(row.trade_name) && clean(row.trade_name) !== clean(row.name) && filled(row.trade_name) ? `Trade name: ${clean(row.trade_name)}` : '',
    [clean(row.address), clean(row.city)]
      .join(', ')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && part.toLowerCase() !== 'pn' && part.toLowerCase() !== 'p.n.' && part.toLowerCase() !== 'pn.')
      .join(', '),
    filled(row.nui_unique_id) && !nui(row.nui_unique_id) ? `NUI in TREFIN: ${clean(row.nui_unique_id)}` : '',
    filled(row.nrb_business_no) ? `NRB: ${clean(row.nrb_business_no)}` : '',
    filled(row.fiscal_no) ? `Fiscal no.: ${clean(row.fiscal_no)}` : '',
    filled(row.vat_no) ? `VAT no.: ${clean(row.vat_no)}` : '',
    filled(row.bank_account_iban) ? `IBAN: ${clean(row.bank_account_iban)}` : '',
    filled(row.contact_person) ? `Contact: ${clean(row.contact_person)}` : '',
    filled(row.mobile) && filled(row.phone) ? `Mobile: ${clean(row.mobile)}` : '',
    ...extra,
    num(balance.value) !== 0 ? `${balance.label} €${money(num(balance.value)).toFixed(2)} in TREFIN on 16 Oct 2026 (not checked, may be out of date)` : '',
    `TREFIN code ${clean(row.code)}`,
  ].filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : null;
}

class DryRun extends Error {}

/**
 * Bring a shop over from TREFIN: its products (with barcode, prices, VAT and
 * stock, negative stock set to 0), suppliers, customers and every sale line,
 * grouped by receipt, plus the product pairs that look like duplicates, for
 * review. Supplier and customer balances go in their notes only. Runs once, on
 * an empty shop, in one transaction. A dry run does all of it and then rolls
 * back, so it proves the data fits without changing anything.
 */
export async function importTrefin(
  db: DatabaseClient,
  data: TrefinExport,
  options: { apply: boolean; timeZone: string; actorId?: number },
): Promise<TrefinImportReport> {
  const notes: Record<string, number> = {};
  const note = (key: string, n = 1) => {
    notes[key] = (notes[key] ?? 0) + n;
  };
  let report: TrefinImportReport | undefined;

  try {
    await db.transaction().execute(async (trx) => {
      const done = await trx.selectFrom('settings').select('value').where('key', '=', TREFIN_IMPORTED_KEY).executeTakeFirst();
      if (done) throw new Error(`TREFIN was already imported (${String(done.value)}). It only runs once.`);
      const existing = await trx.selectFrom('products').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
      if (Number(existing.n) > 0) throw new Error(`The shop already has ${existing.n} products. Wipe the test data first (npm run wipe), then import.`);

      // Category
      const category =
        (await trx.selectFrom('categories').select('id').where(sql`lower(name)`, '=', CATEGORY.toLowerCase()).where('deleted_at', 'is', null).executeTakeFirst()) ??
        (await trx.insertInto('categories').values({ name: CATEGORY, description: 'Everything brought over from TREFIN' }).returning('id').executeTakeFirstOrThrow());

      // Products and their stock
      const productIds = new Map<string, number>();
      const units = new Map<string, string>();
      const costs = new Map<string, number>();
      for (let i = 0; i < data.products.length; i += BATCH) {
        const chunk = data.products.slice(i, i + BATCH);
        const rows = chunk.map((p) => {
          const barcode = clean(p.barcode) || null;
          const vat = Math.round(num(p.vat_rate_percent));
          if (![18, 8, 0].includes(vat)) note('VAT rate not 18/8/0, set to 18%');
          const cost = num(p.purchase_price_incl_vat);
          if (!(cost > 0.005)) note('products without a purchase price (profit unknown)');
          if (!(num(p.sale_price_incl_vat) > 0)) note('products with sale price 0');
          if (clean(p.product_type) !== 'Mall') note('products that are expenses or fixed assets in TREFIN, imported inactive');
          const unit = clean(p.unit);
          units.set(p.product_code!, unit);
          if (cost > 0.005) costs.set(clean(p.product_code), cost);
          if (cost > 0.005 && num(p.sale_price_incl_vat) > 0 && cost > num(p.sale_price_incl_vat) * MAX_COST_TO_PRICE) note('products whose purchase price is above the sale price (check them)');
          return {
            name: clean(p.name).slice(0, 255),
            description: unit && unit !== 'Copë' ? `Unit in TREFIN: ${unit}` : null,
            category_id: category.id,
            base_price: money(Math.max(0, num(p.sale_price_incl_vat))),
            cost_price: cost > 0.005 ? money(cost) : null,
            sku: clean(p.product_code),
            barcode,
            vat_rate: [18, 8, 0].includes(vat) ? vat : 18,
            origin_country: countryFromBarcode(barcode),
            is_active: clean(p.product_type) === 'Mall',
          };
        });
        const inserted = await trx.insertInto('products').values(rows).returning(['id', 'sku']).execute();
        for (const row of inserted) productIds.set(row.sku!, row.id);
        await trx
          .insertInto('inventory')
          .values(
            chunk.map((p) => {
              const stock = num(p.current_stock);
              if (stock < 0) note('products with negative stock, set to 0');
              else if (!Number.isInteger(stock)) note('products with part-unit stock (kg, m²), rounded down');
              const lastPurchase = clean(p.last_purchase_date);
              return {
                product_id: productIds.get(clean(p.product_code))!,
                quantity_on_hand: Math.max(0, Math.floor(stock)),
                reorder_level: Math.max(0, Math.round(num(p.min_stock_level))),
                last_restocked_at: lastPurchase ? startOfDay(lastPurchase, options.timeZone) : null,
              };
            }),
          )
          .execute();
      }

      // Suppliers and customers
      const suppliers = data.suppliers.filter((s) => !GENERIC_PARTNERS.has(clean(s.code)) && clean(s.name));
      if (suppliers.length > 0) {
        await trx
          .insertInto('suppliers')
          .values(
            suppliers.map((s) => ({
              name: clean(s.name).slice(0, 120),
              nui: nui(s.nui_unique_id),
              phone: (filled(s.phone) ?? filled(s.mobile))?.slice(0, 40) ?? null,
              email: filled(s.email)?.slice(0, 255) ?? null,
              note: partnerNote(s, { label: 'We owed them', value: s.balance_we_owe_them ?? '' }),
            })),
          )
          .execute();
      }
      const customers = data.customers.filter((c) => !GENERIC_PARTNERS.has(clean(c.code)) && clean(c.name));
      if (customers.length > 0) {
        await trx
          .insertInto('customers')
          .values(
            customers.map((c) => ({
              name: clean(c.name).slice(0, 120),
              kind: nui(c.nui_unique_id) || /sh\.?p\.?k|d\.o\.o|b\.i\./i.test(c.name ?? '') ? ('business' as const) : ('person' as const),
              nui: nui(c.nui_unique_id),
              phone: (filled(c.phone) ?? filled(c.mobile))?.slice(0, 40) ?? null,
              note: partnerNote(c, { label: 'They owed us', value: c.balance_they_owe_us ?? '' }, [
                num(c.credit_limit) > 0 ? `Credit limit: €${money(num(c.credit_limit)).toFixed(2)}` : '',
                num(c.discount_percent) > 0 ? `Discount: ${num(c.discount_percent)}%` : '',
              ]),
            })),
          )
          .execute();
      }

      // Sales, one row per receipt line
      let sales = 0;
      let revenue = 0;
      const receipts = new Set<string>();
      let firstSale: string | null = null;
      let lastSale: string | null = null;
      for (let i = 0; i < data.sales.length; i += BATCH) {
        const rows = [];
        for (const s of data.sales.slice(i, i + BATCH)) {
          const quantity = num(s.quantity);
          if (!(quantity > 0)) {
            note('sale lines with quantity 0, skipped');
            continue;
          }
          const productId = productIds.get(clean(s.product_code));
          if (!productId) {
            note('sale lines for a product not in the list, skipped');
            continue;
          }
          const total = money(num(s.line_total));
          const vat = num(s.vat_rate_percent);
          // TREFIN's line cost is a running average that mixes box and piece
          // prices, so keep it only when it is believable for one unit, else
          // fall back to the product's purchase price, else leave it unknown.
          const unitPrice = total / quantity;
          const believable = (c: number | undefined) => c !== undefined && c > 0 && (unitPrice === 0 || c <= unitPrice * MAX_COST_TO_PRICE);
          const lineCost = num(s.unit_cost) * (1 + vat / 100);
          const productCost = costs.get(clean(s.product_code));
          const cost = believable(lineCost) ? lineCost : believable(productCost) ? productCost! : null;
          if (num(s.unit_cost) > 0 && cost !== lineCost) note(cost === null ? 'sale lines with an unbelievable cost, cost left unknown' : "sale lines with an unbelievable cost, used the product's purchase price");
          const whole = Number.isInteger(quantity) && Math.abs(money(total / quantity) * quantity - total) < 0.005;
          const lineNotes: string[] = [];
          if (!whole) {
            const unit = units.get(clean(s.product_code)) || 'pcs';
            lineNotes.push(`Sold ${quantity} ${unit === 'Copë' ? 'pcs' : unit} in TREFIN, for €${total.toFixed(2)}`);
            note(Number.isInteger(quantity) ? 'sale lines whose price did not divide evenly, kept as 1 at the line total' : 'sale lines in kg or part units, kept as 1 at the line total');
          }
          if (clean(s.doc_type) !== 'KUP') {
            lineNotes.push(`${clean(s.doc_type_description)} ${clean(s.receipt_number)} to ${clean(s.customer)}, paid ${clean(s.payment_method)}`);
            note('invoice lines (FSM/EKS) to named customers');
          }
          const discount = num(s.discount_percent);
          const withDiscount = whole && discount > 0 && discount <= 100;
          const saleDate = saleMoment(clean(s.sale_date), clean(s.sale_time), options.timeZone);
          const key = `${clean(s.receipt_number)}|${clean(s.sale_date)}`;
          receipts.add(key);
          const day = clean(s.sale_date);
          if (!firstSale || day < firstSale) firstSale = day;
          if (!lastSale || day > lastSale) lastSale = day;
          if (!clean(s.sale_time)) note('sale lines without a time (2022–23), set to 12:00');
          revenue += total;
          rows.push({
            product_id: productId,
            quantity_sold: whole ? quantity : 1,
            price_per_unit: whole ? money(total / quantity) : total,
            unit_cost: cost === null ? null : money(whole ? cost : cost * quantity),
            discount_percent: withDiscount ? discount : null,
            price_before_discount: withDiscount ? money(num(s.unit_price_incl_vat)) : null,
            sale_date: saleDate,
            receipt_no: clean(s.receipt_number).slice(0, 40),
            notes: lineNotes.length > 0 ? lineNotes.join('. ') : null,
          });
        }
        if (rows.length > 0) await trx.insertInto('sales').values(rows).execute();
        sales += rows.length;
      }

      // Pairs that look like the same product
      const flags = new Map<string, { product_id: number; other_product_id: number; reason: string; similarity: number | null }>();
      for (const d of data.duplicates) {
        const a = productIds.get(clean(d.code_a));
        const b = productIds.get(clean(d.code_b));
        if (!a || !b || a === b) continue;
        const [low, high] = a < b ? [a, b] : [b, a];
        flags.set(`${low}-${high}`, { product_id: low, other_product_id: high, reason: clean(d.reason).slice(0, 40), similarity: d.similarity ? num(d.similarity) : null });
      }
      if (flags.size > 0) await trx.insertInto('product_duplicate_flags').values([...flags.values()]).execute();

      const created = {
        products: productIds.size,
        suppliers: suppliers.length,
        customers: customers.length,
        sales,
        checkouts: receipts.size,
        duplicateFlags: flags.size,
      };
      await sql`
        INSERT INTO settings (key, value, updated_at) VALUES (${TREFIN_IMPORTED_KEY}, to_jsonb(now()::text), now())
      `.execute(trx);
      if (options.actorId !== undefined) {
        await sql`
          INSERT INTO activity_log (user_id, action, entity_type, summary, details)
          VALUES (${options.actorId}, 'shop.trefin_imported', 'settings',
            ${`Imported from TREFIN: ${created.products} products, ${created.sales} sale lines, ${created.suppliers} suppliers, ${created.customers} customers`},
            ${JSON.stringify({ created, notes })}::jsonb)
        `.execute(trx);
      }
      report = { applied: options.apply, created, revenue: money(revenue), firstSale, lastSale, notes };
      if (!options.apply) throw new DryRun();
    });
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }
  return report!;
}
