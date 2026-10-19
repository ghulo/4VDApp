import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { escapeLikePattern } from '../utils/databaseErrors.js';

export interface ProductFilters {
  categoryId?: number;
  search?: string;
  inStock?: boolean;
  /** Admins also see products that are switched off. */
  includeInactive: boolean;
  limit: number;
  offset: number;
}

export interface ProductData {
  name: string;
  description: string | null;
  categoryId: number;
  basePrice: number;
  costPrice: number | null;
  imageUrl: string | null;
  sku: string | null;
  isActive: boolean;
  vatRate: number;
  vatExempt: boolean;
  originCountry: string | null;
  /** What a business pays, with VAT; left out keeps it (none for a new product). */
  wholesalePrice?: number | null;
}

/** A product joined with its category name and stock, as the API needs it. */
export interface ProductRecord {
  id: number;
  name: string;
  description: string | null;
  category_id: number;
  category_name: string;
  base_price: string;
  cost_price: string | null;
  image_url: string | null;
  sku: string | null;
  barcode: string | null;
  /** Its other barcodes, oldest first; `barcode` is the main one. */
  other_barcodes: string[];
  is_active: boolean;
  vat_rate: number;
  vat_exempt: boolean;
  origin_country: string | null;
  wholesale_price: string | null;
  quantity_on_hand: number | null;
  reorder_level: number | null;
  created_at: Date;
  updated_at: Date;
}

/** A product's other barcodes, as an array (empty when it has none). */
const otherBarcodes = sql<string[]>`coalesce((SELECT array_agg(b.barcode ORDER BY b.id) FROM product_barcodes b WHERE b.product_id = p.id), '{}')`.as('other_barcodes');

/** Live products whose main or other barcode is this one. */
function hasBarcode(barcode: string) {
  return sql<boolean>`(p.barcode = ${barcode} OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = ${barcode}))`;
}

export class ProductRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery(includeInactive: boolean) {
    let query = this.db
      .selectFrom('products as p')
      .innerJoin('categories as c', 'c.id', 'p.category_id')
      .leftJoin('inventory as i', 'i.product_id', 'p.id')
      .where('p.deleted_at', 'is', null);
    if (!includeInactive) query = query.where('p.is_active', '=', true);
    return query;
  }

  private readonly columns = [
    'p.id',
    'p.name',
    'p.description',
    'p.category_id',
    'c.name as category_name',
    'p.base_price',
    'p.cost_price',
    'p.image_url',
    'p.sku',
    'p.barcode',
    'p.is_active',
    'p.vat_rate',
    'p.vat_exempt',
    'p.origin_country',
    'p.wholesale_price',
    'i.quantity_on_hand',
    'i.reorder_level',
    'p.created_at',
    'p.updated_at',
  ] as const;

  async findMany(filters: ProductFilters): Promise<{ products: ProductRecord[]; total: number }> {
    let query = this.baseQuery(filters.includeInactive);

    if (filters.categoryId) query = query.where('p.category_id', '=', filters.categoryId);
    if (filters.inStock === true) query = query.where('i.quantity_on_hand', '>', 0);
    if (filters.inStock === false) {
      query = query.where((eb) => eb.or([eb('i.quantity_on_hand', '=', 0), eb('i.quantity_on_hand', 'is', null)]));
    }
    if (filters.search) {
      const pattern = `%${escapeLikePattern(filters.search)}%`;
      // A scanned barcode matches exactly; names and SKUs match in part.
      query = query.where((eb) =>
        eb.or([eb('p.name', 'ilike', pattern), eb('p.sku', 'ilike', pattern), hasBarcode(filters.search!.trim())]),
      );
    }

    const [products, count] = await Promise.all([
      query.select(this.columns).select(otherBarcodes).orderBy('p.name').orderBy('p.id').limit(filters.limit).offset(filters.offset).execute(),
      query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { products, total: Number(count.total) };
  }

  /** Every product on sale, by name: the Counter's shelf in one go. */
  findShelf(): Promise<ProductRecord[]> {
    return this.baseQuery(false).select(this.columns).select(otherBarcodes).orderBy('p.name').orderBy('p.id').execute();
  }

  findById(id: number, includeInactive: boolean): Promise<ProductRecord | undefined> {
    return this.baseQuery(includeInactive).select(this.columns).select(otherBarcodes).where('p.id', '=', id).executeTakeFirst();
  }

  findByIds(ids: number[], includeInactive: boolean): Promise<ProductRecord[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.baseQuery(includeInactive).select(this.columns).select(otherBarcodes).where('p.id', 'in', ids).execute();
  }

  async exists(id: number): Promise<boolean> {
    const row = await this.db
      .selectFrom('products')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row !== undefined;
  }

  async create(data: ProductData): Promise<number> {
    const row = await this.db
      .insertInto('products')
      .values({
        name: data.name,
        description: data.description,
        category_id: data.categoryId,
        base_price: data.basePrice,
        cost_price: data.costPrice,
        image_url: data.imageUrl,
        sku: data.sku,
        is_active: data.isActive,
        vat_rate: data.vatRate,
        vat_exempt: data.vatExempt,
        origin_country: data.originCountry,
        wholesale_price: data.wholesalePrice ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async update(id: number, data: ProductData): Promise<boolean> {
    const result = await this.db
      .updateTable('products')
      .set({
        name: data.name,
        description: data.description,
        category_id: data.categoryId,
        base_price: data.basePrice,
        cost_price: data.costPrice,
        image_url: data.imageUrl,
        sku: data.sku,
        is_active: data.isActive,
        vat_rate: data.vatRate,
        vat_exempt: data.vatExempt,
        origin_country: data.originCountry,
        ...(data.wholesalePrice !== undefined && { wholesale_price: data.wholesalePrice }),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** Every live product, with just what matching a supplier's bill needs. */
  async findAllForMatching(): Promise<
    Array<{ id: number; name: string; sku: string | null; barcode: string | null; other_barcodes: string[]; cost_price: string | null; vat_rate: number }>
  > {
    return this.db
      .selectFrom('products as p')
      .select(['p.id', 'p.name', 'p.sku', 'p.barcode', 'p.cost_price', 'p.vat_rate'])
      .select(otherBarcodes)
      .where('p.deleted_at', 'is', null)
      .orderBy('p.name')
      .execute();
  }

  /** The live product with this barcode, main or other, if any. */
  async findIdByBarcode(barcode: string): Promise<number | undefined> {
    const row = await this.db
      .selectFrom('products as p')
      .select('p.id')
      .where(hasBarcode(barcode))
      .where('p.deleted_at', 'is', null)
      .executeTakeFirst();
    return row?.id;
  }

  /**
   * Gives the product another barcode. A deleted product still holding it
   * lets go first; the caller has checked no live product has it.
   */
  async addOtherBarcode(productId: number, barcode: string, actorId: number | null): Promise<void> {
    await sql`
      DELETE FROM product_barcodes b USING products p
      WHERE b.barcode = ${barcode} AND p.id = b.product_id AND p.deleted_at IS NOT NULL
    `.execute(this.db);
    await this.db.insertInto('product_barcodes').values({ product_id: productId, barcode, added_by: actorId }).execute();
  }

  /** Takes one of the product's other barcodes off it; false when it didn't have it. */
  async removeOtherBarcode(productId: number, barcode: string): Promise<boolean> {
    const result = await this.db.deleteFrom('product_barcodes').where('product_id', '=', productId).where('barcode', '=', barcode).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /** Moves every other barcode of one product onto another (merging duplicates). */
  async moveOtherBarcodes(fromId: number, toId: number): Promise<void> {
    await this.db.updateTable('product_barcodes').set({ product_id: toId }).where('product_id', '=', fromId).execute();
  }

  async setImageUrl(id: number, imageUrl: string | null): Promise<void> {
    await this.db.updateTable('products').set({ image_url: imageUrl, updated_at: new Date() }).where('id', '=', id).execute();
  }

  async setBarcode(id: number, barcode: string | null): Promise<void> {
    await this.db.updateTable('products').set({ barcode, updated_at: new Date() }).where('id', '=', id).execute();
  }

  async setOriginCountry(id: number, country: string | null): Promise<void> {
    await this.db.updateTable('products').set({ origin_country: country, updated_at: new Date() }).where('id', '=', id).execute();
  }

  /** Whether the product was ever sold; a sold product is kept, not removed. */
  async hasSales(id: number): Promise<boolean> {
    return Boolean(await this.db.selectFrom('sales').select('id').where('product_id', '=', id).limit(1).executeTakeFirst());
  }

  async softDelete(id: number): Promise<boolean> {
    const result = await this.db
      .updateTable('products')
      .set({ deleted_at: new Date(), is_active: false, updated_at: new Date() })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
