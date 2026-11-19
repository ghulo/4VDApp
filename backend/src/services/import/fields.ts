import { normalise } from '../money/statementFile.js';

/**
 * What an import can bring in, and how 4VD recognises it: the fields of each
 * kind with the headings they go by (English, Albanian, Serbian and the names
 * other programs use), and the known programs as profiles. A profile is data
 * only, so a new program (iSoft, Pro-Data…) is added from one real export by
 * writing its file names and column names here.
 */

export const IMPORT_KINDS = ['products', 'suppliers', 'customers'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const PRODUCT_FIELDS = [
  'code',
  'barcode',
  'otherBarcodes',
  'name',
  'category',
  'unit',
  'price',
  'priceNet',
  'wholesale',
  'cost',
  'costNet',
  'vat',
  'stock',
  'reorder',
  'supplier',
] as const;
export const PARTNER_FIELDS = [
  'code',
  'name',
  'nui',
  'businessNo',
  'fiscalNo',
  'vatNo',
  'phone',
  'mobile',
  'email',
  'address',
  'city',
  'iban',
  'contact',
  'owed',
  'creditLimit',
  'discount',
] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];
export type PartnerField = (typeof PARTNER_FIELDS)[number];
export type Field = ProductField | PartnerField;

export const FIELDS_OF: Record<ImportKind, readonly Field[]> = {
  products: PRODUCT_FIELDS,
  suppliers: PARTNER_FIELDS,
  customers: PARTNER_FIELDS,
};

/** Headings, written as `normalise` leaves them (lower case, no accents, single spaces). */
const PRODUCT_HEADINGS: Record<ProductField, string[]> = {
  code: ['code', 'kodi', 'kod', 'shifra', 'shifer', 'sifra', 'sku', 'product code', 'item code', 'article code', 'nr artikulli', 'id artikulli', 'artikull kodi', 'kodi i artikullit'],
  barcode: ['barcode', 'bar code', 'barkod', 'barkodi', 'bar kodi', 'ean', 'ean13', 'ean 13', 'gtin', 'upc', 'barkodi kryesor'],
  otherBarcodes: ['other barcodes', 'barkode te tjera', 'barkodet e tjera', 'barkodi 2', 'barcode 2', 'barkod 2'],
  name: ['name', 'emri', 'emertimi', 'emertim', 'artikulli', 'artikull', 'pershkrimi', 'pershkrim', 'product', 'product name', 'item', 'item name', 'description', 'naziv', 'emri i artikullit', 'malli'],
  category: ['category', 'kategoria', 'kategori', 'grupi', 'grup', 'grupi i artikullit', 'group', 'kategorija', 'department', 'reparti'],
  unit: ['unit', 'njesia', 'njesi', 'njm', 'nj m', 'njesia matese', 'uom', 'jedinica', 'jm', 'mass unit'],
  price: [
    'price',
    'cmimi',
    'cmim',
    'cmimi shitjes',
    'cmimi i shitjes',
    'cmimi me tvsh',
    'cmimi shitjes me tvsh',
    'shitja me tvsh',
    'cmimi me pakice',
    'cmimi pakice',
    'retail price',
    'sale price',
    'selling price',
    'price incl vat',
    'price with vat',
    'mpc',
    'cena',
    'vpc me tvsh',
  ],
  priceNet: ['cmimi pa tvsh', 'cmimi shitjes pa tvsh', 'price excl vat', 'price without vat', 'net price', 'shitja pa tvsh'],
  wholesale: ['wholesale', 'wholesale price', 'cmimi shumice', 'cmimi me shumice', 'shumice', 'cmimi i fatures', 'invoice price', 'vpc'],
  cost: ['cost', 'kosto', 'kostoja', 'cmimi blerjes', 'cmimi i blerjes', 'cmimi blerjes me tvsh', 'blerja', 'blerja me tvsh', 'purchase price', 'buy price', 'cost price', 'nabavna cena', 'cmimi furnizimit'],
  costNet: ['cmimi blerjes pa tvsh', 'blerja pa tvsh', 'cost excl vat', 'cost without vat', 'net cost', 'purchase price excl vat'],
  vat: ['vat', 'vat rate', 'tvsh', 'tvsh %', 'tvsh perqind', 'norma tvsh', 'shkalla e tvsh', 'pdv', 'tax', 'tax rate', 'vat %'],
  stock: ['stock', 'sasia', 'sasi', 'gjendja', 'gjendje', 'stoku', 'stok', 'qty', 'quantity', 'on hand', 'kolicina', 'zaliha', 'sasia ne stok', 'gjendja aktuale'],
  reorder: ['reorder', 'reorder level', 'minimum', 'min', 'sasia minimale', 'stoku minimal', 'min stock', 'minimalna kolicina'],
  supplier: ['supplier', 'furnitori', 'furnitor', 'furnizuesi', 'dobavljac', 'vendor', 'furnitori i fundit'],
};

const PARTNER_HEADINGS: Record<PartnerField, string[]> = {
  code: ['code', 'kodi', 'shifra', 'sifra', 'partner code', 'nr', 'id'],
  name: ['name', 'emri', 'emertimi', 'subjekti', 'klienti', 'bleresi', 'furnitori', 'partneri', 'naziv', 'company', 'business name', 'emri i biznesit', 'kompania'],
  nui: ['nui', 'nr unik', 'numri unik', 'numri unik identifikues', 'nui unique id', 'unique id', 'nipt'],
  businessNo: ['nrb', 'nr biznesit', 'numri i biznesit', 'business no', 'business number', 'nrb business no'],
  fiscalNo: ['nr fiskal', 'numri fiskal', 'fiscal no', 'fiscal number'],
  vatNo: ['nr tvsh', 'numri i tvsh', 'vat no', 'vat number', 'tvsh nr'],
  phone: ['phone', 'tel', 'telefon', 'telefoni', 'nr telefonit', 'telephone'],
  mobile: ['mobile', 'mobil', 'celular', 'cel'],
  email: ['email', 'e mail', 'mail', 'posta elektronike'],
  address: ['address', 'adresa', 'adrese', 'rruga', 'adresa e biznesit'],
  city: ['city', 'qyteti', 'qytet', 'komuna', 'vendi', 'grad'],
  iban: ['iban', 'llogaria', 'llogaria bankare', 'bank account', 'xhirollogaria', 'bank account iban'],
  contact: ['contact', 'contact person', 'personi kontaktues', 'kontakti', 'personi'],
  owed: ['owed', 'balance', 'bilanci', 'saldo', 'borxhi', 'detyrimi', 'gjendja', 'balance they owe us', 'balance we owe them', 'they owe', 'we owe'],
  creditLimit: ['credit limit', 'limiti', 'limiti i kreditit', 'kufiri'],
  discount: ['discount', 'rabat', 'rabati', 'zbritja', 'discount percent', 'rabat %'],
};

export const HEADINGS: Record<ImportKind, Record<string, string[]>> = {
  products: PRODUCT_HEADINGS,
  suppliers: PARTNER_HEADINGS,
  customers: PARTNER_HEADINGS,
};

/** The field a heading names, for one kind of file; null when none fits. */
export function fieldForHeading(kind: ImportKind, heading: string): Field | null {
  const text = normalise(heading);
  if (!text) return null;
  const table = HEADINGS[kind];
  for (const [field, names] of Object.entries(table)) if (names.includes(text)) return field as Field;
  // "Çmimi (EUR)", "Barkodi / Barcode": the longest known name it starts or ends with.
  let best: { field: Field; length: number } | null = null;
  for (const [field, names] of Object.entries(table)) {
    for (const name of names) {
      if (name.length < 3) continue;
      if (text.startsWith(`${name} `) || text.endsWith(` ${name}`) || text === name) {
        if (!best || name.length > best.length) best = { field: field as Field, length: name.length };
      }
    }
  }
  return best?.field ?? null;
}

/** File names that say what a file holds, when the headings alone can't tell suppliers from customers. */
export const KIND_BY_FILE_NAME: Array<[RegExp, ImportKind]> = [
  [/furnit|furniz|supplier|vendor|dobavlj/i, 'suppliers'],
  [/klient|bleres|blerës|customer|kupc/i, 'customers'],
  [/artik|produkt|product|item|mall|cmim|çmim|price|stok|stock|lista/i, 'products'],
];

// ---------- Profiles: programs 4VD knows ----------

export interface ProfileFile {
  /** Matches the file's name (without its folder). */
  name: RegExp;
  /** Headings that must all be there (exact, as written in the file). */
  required: string[];
  kind: ImportKind;
  /** Field → the file's heading. */
  columns: Partial<Record<Field, string>>;
}

export interface Profile {
  id: string;
  /** Shown as "This is an export from <name>". */
  name: string;
  files: ProfileFile[];
  /** A file of product code → category, filled by 4VD's categoriser or by hand. */
  categories?: { name: RegExp; code: string; category: string };
  /** Files that are known and deliberately left out, with why. */
  leftOut: Array<{ name: RegExp; why: 'history' | 'notNeeded' }>;
  /** Products whose heading `column` isn't `equals` come in inactive (TREFIN's expenses and fixed assets). */
  activeWhen?: { column: string; equals: string };
  /** A heading that marks products sold by weight. */
  soldByScale?: string;
}

export const PROFILES: Profile[] = [
  {
    id: 'trefin',
    name: 'TREFIN',
    files: [
      {
        name: /^products\.csv$/i,
        required: ['product_code', 'name', 'sale_price_incl_vat'],
        kind: 'products',
        columns: {
          code: 'product_code',
          barcode: 'barcode',
          otherBarcodes: 'other_barcodes',
          name: 'name',
          category: 'category',
          unit: 'unit',
          price: 'sale_price_incl_vat',
          wholesale: 'invoice_price_incl_vat',
          cost: 'purchase_price_incl_vat',
          vat: 'vat_rate_percent',
          stock: 'current_stock',
          reorder: 'min_stock_level',
          supplier: 'last_supplier',
        },
      },
      {
        name: /^suppliers\.csv$/i,
        required: ['code', 'name', 'balance_we_owe_them'],
        kind: 'suppliers',
        columns: {
          code: 'code',
          name: 'name',
          nui: 'nui_unique_id',
          businessNo: 'nrb_business_no',
          fiscalNo: 'fiscal_no',
          vatNo: 'vat_no',
          phone: 'phone',
          mobile: 'mobile',
          email: 'email',
          address: 'address',
          city: 'city',
          iban: 'bank_account_iban',
          contact: 'contact_person',
          owed: 'balance_we_owe_them',
        },
      },
      {
        name: /^customers\.csv$/i,
        required: ['code', 'name', 'balance_they_owe_us'],
        kind: 'customers',
        columns: {
          code: 'code',
          name: 'name',
          nui: 'nui_unique_id',
          businessNo: 'nrb_business_no',
          fiscalNo: 'fiscal_no',
          vatNo: 'vat_no',
          phone: 'phone',
          mobile: 'mobile',
          email: 'email',
          address: 'address',
          city: 'city',
          iban: 'bank_account_iban',
          contact: 'contact_person',
          owed: 'balance_they_owe_us',
          creditLimit: 'credit_limit',
          discount: 'discount_percent',
        },
      },
    ],
    categories: { name: /^categories\.csv$/i, code: 'product_code', category: 'category' },
    leftOut: [
      { name: /^(sales|purchases)\.csv$/i, why: 'history' },
      { name: /^(stock_movements|duplicates|negative_stock)\.csv$/i, why: 'notNeeded' },
    ],
    activeWhen: { column: 'product_type', equals: 'Mall' },
    soldByScale: 'sold_by_scale',
  },
];

/** The base name of a file inside a folder or zip. */
export const baseName = (file: string) => file.split(/[\\/]/).pop() ?? file;
