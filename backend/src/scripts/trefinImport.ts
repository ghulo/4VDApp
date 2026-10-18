import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { countryFromBarcode } from '../utils/barcodeCountry.js';
import { startOfDay } from '../utils/zonedDates.js';
import {
  DATABASE_LABELS,
  PURCHASE_TYPES,
  clean,
  mergePartners,
  money,
  normalName,
  num,
  parseCsv,
  readTrefinHistory,
  sameName,
  trefinBills,
  type TrefinHistory,
  type TrefinPartner,
} from './trefinHistory.js';

/** What has to be typed to really import, so it can't happen by accident. */
export const IMPORT_PHRASE = 'import trefin';
/** Settings key written once the import is done, so it can't run twice. */
export const TREFIN_IMPORTED_KEY = 'trefin_imported_at';
/** TREFIN keeps every product in this one category; here it is what's left over. */
const CATEGORY = 'Të ndryshme';
/** The categories a market's products are sorted into (see categoriseTrefin). */
export const MARKET_CATEGORIES = [
  'Cigare dhe duhan',
  'Ujë',
  'Pije freskuese',
  'Pije energjike',
  'Alkool',
  'Kafe dhe çaj',
  'Çokollata dhe ëmbëlsira',
  'Biskota dhe kek',
  'Çipsa dhe fara',
  'Bulmet dhe vezë',
  'Mish dhe sallam',
  'Fruta dhe perime',
  'Bukë dhe furrë',
  'Ushqime bazë',
  'Akullore dhe të ngrira',
  'Higjienë personale',
  'Pastrim shtëpie',
  'Shtëpi dhe kopsht',
  'Elektronikë',
  CATEGORY,
] as const;
/** product_code → category, written by categoriseTrefin and checked by hand. */
export const CATEGORIES_FILE = 'categories.csv';
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
  /** product_code → category name; products not in it go to "Të ndryshme". */
  categories: Map<string, string>;
  /** The raw tables of every database: partners, purchases, old product names. Missing in an older export. */
  history?: TrefinHistory;
}

export interface TrefinImportReport {
  applied: boolean;
  created: {
    categories: number;
    products: number;
    /** Products only an older database had under a code that later went to another product: kept inactive. */
    oldProducts: number;
    suppliers: number;
    customers: number;
    sales: number;
    checkouts: number;
    duplicateFlags: number;
    /** TREFIN's purchases as look-only bills, and how many of them were deleted in TREFIN. */
    bills: number;
    billLines: number;
    deletedBills: number;
  };
  revenue: number;
  firstSale: string | null;
  lastSale: string | null;
  /** Things worth knowing about, with how many rows each touched. */
  notes: Record<string, number>;
}

export { parseCsv };

/** The sorted categories, if categoriseTrefin has run; empty otherwise. */
export function readCategoryFile(dir: string): Map<string, string> {
  const file = path.join(dir, CATEGORIES_FILE);
  if (!fs.existsSync(file)) return new Map();
  return new Map(
    parseCsv(fs.readFileSync(file, 'utf8'))
      .map((row) => [clean(row.product_code), clean(row.category)] as const)
      .filter(([code, category]) => code && category),
  );
}

export function readTrefinExport(dir: string): TrefinExport {
  const load = (name: string) => parseCsv(fs.readFileSync(path.join(dir, `${name}.csv`), 'utf8'));
  return {
    products: load('products'),
    suppliers: load('suppliers'),
    customers: load('customers'),
    sales: load('sales'),
    duplicates: load('duplicates'),
    categories: readCategoryFile(dir),
    history: readTrefinHistory(dir),
  };
}

/** A sale's moment: TREFIN's date and time on the shop's clock (noon when it kept no time). */
function saleMoment(day: string, time: string, timeZone: string): Date {
  const [h, m, s] = (time || '12:00:00').split(':').map(Number);
  return new Date(startOfDay(day, timeZone).getTime() + ((h ?? 12) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000);
}

/** What a partner's details can't hold: a trade name, an odd NUI, the balance TREFIN showed and its code. */
function partnerNote(partner: TrefinPartner, balance: { label: string; value: number }): string {
  return [
    partner.tradeName && !sameName(partner.tradeName, partner.name) ? `Trade name: ${partner.tradeName}` : '',
    partner.oddNui ? `NUI in TREFIN: ${partner.oddNui}` : '',
    balance.value !== 0 ? `${balance.label} €${money(balance.value).toFixed(2)} in TREFIN on 16 Oct 2026 (not checked, may be out of date)` : '',
    `TREFIN code ${partner.code}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const partnerDetails = (partner: TrefinPartner) => ({
  address: partner.address?.slice(0, 200) ?? null,
  city: partner.city?.slice(0, 80) ?? null,
  business_no: partner.businessNo?.slice(0, 40) ?? null,
  fiscal_no: partner.fiscalNo?.slice(0, 40) ?? null,
  vat_no: partner.vatNo?.slice(0, 40) ?? null,
  iban: partner.iban?.slice(0, 60) ?? null,
  contact_person: partner.contactPerson?.slice(0, 120) ?? null,
  // The phone field takes the phone, else the mobile; the mobile has its own field only beside a phone.
  mobile: partner.phone && partner.mobile ? partner.mobile.slice(0, 40) : null,
  external_code: partner.code.slice(0, 40),
});

/** TREFIN's VAT rates that 4VD knows; anything else is taken as 18%. */
const VAT_RATES = [0, 8, 16, 18];

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

      // Categories: the sorted ones in use, plus the leftover one; an existing category of the same name is reused.
      const categoryOf = (code: string) => data.categories.get(code) || CATEGORY;
      const categoryIds = new Map<string, number>();
      let newCategories = 0;
      for (const name of new Set(data.products.map((p) => categoryOf(clean(p.product_code))))) {
        const existing = await trx.selectFrom('categories').select('id').where(sql`lower(name)`, '=', name.toLowerCase()).where('deleted_at', 'is', null).executeTakeFirst();
        if (existing) categoryIds.set(name, existing.id);
        else {
          const created = await trx.insertInto('categories').values({ name: name.slice(0, 255), description: null }).returning('id').executeTakeFirstOrThrow();
          categoryIds.set(name, created.id);
          newCategories++;
        }
      }
      if (data.categories.size === 0) note('no categories.csv: every product went to "Të ndryshme" (run categorise:trefin first)');
      else note('products not in categories.csv, put in "Të ndryshme"', data.products.filter((p) => !data.categories.has(clean(p.product_code))).length);

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
          // TREFIN's second ("invoice") price list is what businesses pay; empty or the same as the shelf price: none.
          const wholesale = num(p.invoice_price_incl_vat);
          const hasWholesale = wholesale > 0 && Math.abs(wholesale - num(p.sale_price_incl_vat)) >= 0.005;
          if (hasWholesale) note('products with a wholesale price (TREFIN\'s invoice price)');
          return {
            name: clean(p.name).slice(0, 255),
            description: unit && unit !== 'Copë' ? `Unit in TREFIN: ${unit}` : null,
            wholesale_price: hasWholesale ? money(wholesale) : null,
            category_id: categoryIds.get(categoryOf(clean(p.product_code)))!,
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

      // Which product a line from one of TREFIN's databases means. Today's database uses today's codes; an older
      // one may have used a code for another product before it was reused, so its line must agree on the barcode
      // or the name, else it is found by barcode or name, else it stays an inactive product of its own.
      const current = new Map(data.products.map((p) => [clean(p.product_code), { barcode: clean(p.barcode), name: clean(p.name) }]));
      const byBarcode = new Map<string, number>();
      const byName = new Map<string, number>();
      for (const [code, known] of current) {
        const id = productIds.get(code)!;
        if (known.barcode) byBarcode.set(known.barcode, id);
        if (!byName.has(normalName(known.name))) byName.set(normalName(known.name), id);
      }
      const oldProducts = new Map<string, number>();
      const productFor = async (line: { db?: string; code: string; barcode: string; name: string; price: number }): Promise<number | undefined> => {
        const today = productIds.get(line.code);
        if (!line.db || line.db === 'MARKET_2025' || (!line.barcode && !line.name)) return today;
        const known = current.get(line.code);
        if (today && known && ((line.barcode && line.barcode === known.barcode) || (line.name && sameName(line.name, known.name)))) return today;
        const found = (line.barcode && byBarcode.get(line.barcode)) || (line.name && byName.get(normalName(line.name)));
        if (found) {
          note('lines from an older database matched to today\'s product by barcode or name (its code was reused)');
          return found;
        }
        if (!line.name) return today;
        const key = `${line.db}/${line.code}`;
        const existing = oldProducts.get(key);
        if (existing) return existing;
        const created = await trx
          .insertInto('products')
          .values({
            name: line.name.slice(0, 255),
            description: `Sold in TREFIN as code ${line.code} in ${DATABASE_LABELS[line.db] ?? line.db}, before the code went to another product.`,
            category_id: categoryIds.get(CATEGORY) ?? (await leftoverCategory()),
            base_price: money(Math.max(0, line.price)),
            cost_price: null,
            sku: null,
            barcode: line.barcode && !byBarcode.has(line.barcode) ? line.barcode : null,
            vat_rate: 18,
            origin_country: countryFromBarcode(line.barcode || null),
            is_active: false,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx.insertInto('inventory').values({ product_id: created.id, quantity_on_hand: 0, reorder_level: 0 }).execute();
        if (line.barcode && !byBarcode.has(line.barcode)) byBarcode.set(line.barcode, created.id);
        oldProducts.set(key, created.id);
        return created.id;
      };
      const leftoverCategory = async () => {
        const created = await trx.insertInto('categories').values({ name: CATEGORY, description: null }).returning('id').executeTakeFirstOrThrow();
        categoryIds.set(CATEGORY, created.id);
        newCategories++;
        return created.id;
      };

      // Suppliers and customers, merged from every database
      const { partners, byKey } = mergePartners({ suppliers: data.suppliers, customers: data.customers }, data.history);
      const supplierIds = new Map<TrefinPartner, number>();
      const suppliers = partners.filter((p) => p.isSupplier);
      if (suppliers.length > 0) {
        const inserted = await trx
          .insertInto('suppliers')
          .values(
            suppliers.map((p) => ({
              name: p.name.slice(0, 120),
              nui: p.nui,
              phone: (p.phone ?? p.mobile)?.slice(0, 40) ?? null,
              email: p.email?.slice(0, 255) ?? null,
              note: partnerNote(p, { label: 'We owed them', value: p.weOwe }),
              ...partnerDetails(p),
            })),
          )
          .returning('id')
          .execute();
        suppliers.forEach((p, i) => supplierIds.set(p, inserted[i]!.id));
      }
      const customers = partners.filter((p) => p.isCustomer);
      if (customers.length > 0) {
        await trx
          .insertInto('customers')
          .values(
            customers.map((p) => ({
              name: p.name.slice(0, 120),
              kind: p.nui || /sh\.?p\.?k|d\.o\.o|b\.i\./i.test(p.name) ? ('business' as const) : ('person' as const),
              nui: p.nui,
              phone: (p.phone ?? p.mobile)?.slice(0, 40) ?? null,
              note: partnerNote(p, { label: 'They owed us', value: p.theyOwe }),
              ...partnerDetails(p),
              credit_limit: p.creditLimit,
              discount_percent: p.discountPercent,
            })),
          )
          .execute();
      }
      if (data.history) note('suppliers and customers only an older TREFIN database knew', partners.filter((p) => !p.keys.some((k) => k.startsWith('clean/'))).length);

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
          const productId = await productFor({ db: clean(s.source_db) || undefined, code: clean(s.product_code), barcode: clean(s.barcode), name: clean(s.product_name), price: num(s.unit_price_incl_vat) });
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
          // A product found through an older database's reused code has no purchase price of its own here.
          const productCost = productId === productIds.get(clean(s.product_code)) ? costs.get(clean(s.product_code)) : undefined;
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

      // TREFIN's purchases, as bills to look at: no stock moves, nothing posted or owed.
      let bills = 0;
      let billLines = 0;
      let deletedBills = 0;
      for (const bill of data.history ? trefinBills(data.history) : []) {
        const partner = byKey.get(bill.supplierKey);
        const supplierId = partner ? supplierIds.get(partner) : undefined;
        if (!supplierId) note('bills from TREFIN\'s "any supplier" or an unknown one (name in the note)');
        const credit = bill.type === 'KB';
        const notes = [
          `From TREFIN: ${PURCHASE_TYPES[bill.type] ?? bill.type} in ${DATABASE_LABELS[bill.db] ?? bill.db}.`,
          !supplierId && bill.supplierName ? `Supplier in TREFIN: ${bill.supplierName}.` : '',
          bill.paidInTrefin !== null ? `Marked paid in TREFIN: €${bill.paidInTrefin.toFixed(2)}.` : 'Not marked paid in TREFIN.',
        ];
        const rows: Array<{ code: string; barcode: string; name: string; unit: string; quantity: number; unitNet: number; net: number; vat: number; vatRate: number; productId: number }> = [];
        for (const line of bill.lines) {
          // A return's lines may carry minus signs; on a bill, a line below zero can't be shown as a product line.
          const quantity = credit ? Math.abs(line.quantity) : line.quantity;
          if (!(quantity > 0) || (!credit && line.net < 0)) {
            note(quantity === 0 ? 'bill lines with quantity 0, skipped' : 'bill lines below zero, skipped (the bill\'s total is TREFIN\'s)');
            continue;
          }
          const productId = await productFor({ db: bill.db, code: line.code, barcode: line.barcode, name: line.name, price: 0 });
          if (!productId) {
            note('bill lines for a product not in the list, skipped');
            continue;
          }
          rows.push({ ...line, quantity, net: credit ? Math.abs(line.net) : line.net, vat: credit ? Math.abs(line.vat) : line.vat, productId });
        }
        const inserted = await trx
          .insertInto('supplier_bills')
          .values({
            supplier_id: supplierId ?? null,
            number: bill.number?.slice(0, 60) ?? null,
            issued_on: bill.issuedOn,
            due_on: null,
            amount: money(Math.abs(bill.amount)),
            vat_amount: bill.vat !== null && bill.vat >= 0 ? bill.vat : null,
            note: notes.filter(Boolean).join(' '),
            kind: credit ? 'credit' : 'bill',
            abroad: bill.type === 'FBI',
            prices_include_vat: false,
            voided_at: bill.deleted ? saleMoment(bill.deleted.at.slice(0, 10), bill.deleted.at.slice(11, 19), options.timeZone) : null,
            void_note: bill.deleted ? `Deleted in TREFIN${bill.deleted.by ? ` by ${bill.deleted.by}` : ''}` : null,
            trefin_ref: bill.ref.slice(0, 80),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (rows.length > 0) {
          await trx
            .insertInto('bill_lines')
            .values(
              rows.map((line, i) => {
                const whole = Number.isInteger(line.quantity);
                if (!whole) note('bill lines in kg or part units, kept as 1 at the line total');
                const rate = VAT_RATES.includes(line.vatRate) ? line.vatRate : 18;
                return {
                  bill_id: inserted.id,
                  position: i + 1,
                  kind: 'product' as const,
                  product_id: line.productId,
                  quantity: whole ? line.quantity : 1,
                  unit_price: whole ? Math.max(0, line.unitNet) : money(line.net),
                  description: whole ? null : `${line.quantity} ${line.unit || 'units'} in TREFIN`,
                  vat_rate: rate,
                  net: money(line.net),
                  vat: money(Math.max(0, line.vat)),
                  landed: money(line.net),
                };
              }),
            )
            .execute();
        }
        bills++;
        billLines += rows.length;
        if (bill.deleted) deletedBills++;
      }

      const created = {
        categories: newCategories,
        products: productIds.size,
        oldProducts: oldProducts.size,
        suppliers: suppliers.length,
        customers: customers.length,
        sales,
        checkouts: receipts.size,
        duplicateFlags: flags.size,
        bills,
        billLines,
        deletedBills,
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
