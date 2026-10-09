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
  is_active: boolean;
  vat_rate: number;
  quantity_on_hand: number | null;
  reorder_level: number | null;
  created_at: Date;
  updated_at: Date;
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
        eb.or([eb('p.name', 'ilike', pattern), eb('p.sku', 'ilike', pattern), eb('p.barcode', '=', filters.search!.trim())]),
      );
    }

    const [products, count] = await Promise.all([
      query.select(this.columns).orderBy('p.name').orderBy('p.id').limit(filters.limit).offset(filters.offset).execute(),
      query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { products, total: Number(count.total) };
  }

  findById(id: number, includeInactive: boolean): Promise<ProductRecord | undefined> {
    return this.baseQuery(includeInactive).select(this.columns).where('p.id', '=', id).executeTakeFirst();
  }

  findByIds(ids: number[], includeInactive: boolean): Promise<ProductRecord[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.baseQuery(includeInactive).select(this.columns).where('p.id', 'in', ids).execute();
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
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** The live product with this barcode, if any. */
  async findIdByBarcode(barcode: string): Promise<number | undefined> {
    const row = await this.db
      .selectFrom('products')
      .select('id')
      .where('barcode', '=', barcode)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row?.id;
  }

  async setImageUrl(id: number, imageUrl: string | null): Promise<void> {
    await this.db.updateTable('products').set({ image_url: imageUrl, updated_at: new Date() }).where('id', '=', id).execute();
  }

  async setBarcode(id: number, barcode: string | null): Promise<void> {
    await this.db.updateTable('products').set({ barcode, updated_at: new Date() }).where('id', '=', id).execute();
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
