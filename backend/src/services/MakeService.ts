import { sql } from 'kysely';
import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { allowsParts } from '../constants/units.js';
import type { DatabaseClient } from '../database/connection.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { zonedDay, zonedDays } from '../utils/zonedDates.js';
import { applyStockChange } from './InventoryService.js';
import { changeCost } from './PurchaseOrderService.js';
import type { DateRange } from './reports/calculations.js';
import { formatNumber, readRules } from './shopRules.js';
import { pickLocation } from './StockDocumentService.js';
import { assertMonthsOpen } from './vat/periodLock.js';

export interface RecipePartDto {
  productId: number;
  name: string;
  unit: string;
  /** How many go into one made unit. */
  quantity: number;
  cost: number | null;
}

/** One part of a planned Make: what it takes, what it costs, and how much there is. */
export interface MakePlanPartDto extends RecipePartDto {
  /** quantity × how many are made. */
  needed: number;
  /** Held at the chosen location. */
  atLocation: number;
  /** Held everywhere. */
  inStock: number;
}

export interface MakePlanDto {
  productId: number;
  productName: string;
  unit: string;
  quantity: number;
  locationId: number;
  locationName: string;
  parts: MakePlanPartDto[];
  /** Null while a part has no cost. */
  unitCost: number | null;
  /** The parts with no cost: the Make is refused until they have one. */
  noCost: string[];
  /** The parts short in all locations together. */
  short: string[];
  /** The earliest open best-before date among the parts, to default the made product's. */
  earliestExpiry: string | null;
}

export interface MakeLineDto {
  productId: number;
  productName: string;
  unit: string;
  quantity: number;
  unitCost: number;
}

export interface MakeDto {
  id: number;
  number: string;
  productId: number;
  productName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  value: number;
  day: string;
  locationId: number | null;
  locationName: string | null;
  expiresOn: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  lines?: MakeLineDto[];
}

export interface NewMakeInput {
  productId: number;
  quantity: number;
  day: string;
  locationId?: number | null;
  expiresOn?: string | null;
  note: string | null;
}

const roundQuantity = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Products made here from other products. A recipe says what goes into one;
 * a Make takes the parts out of one location and puts the made product in
 * there at the parts' summed cost, which becomes the product's cost. Parts and
 * product are all stock, so a Make writes nothing in the books (stock in, stock
 * out, same account). Voiding puts it all back and restores the cost before.
 */
export class MakeService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  /** The products that have a recipe, for the Make form. */
  async madeProducts(): Promise<Array<{ productId: number; name: string; unit: string; parts: number }>> {
    const rows = await this.db
      .selectFrom('recipe_parts as r')
      .innerJoin('products as p', 'p.id', 'r.product_id')
      .select(['p.id', 'p.name', 'p.unit', (eb) => eb.fn.countAll<string>().as('parts')])
      .where('p.deleted_at', 'is', null)
      .groupBy(['p.id', 'p.name', 'p.unit'])
      .orderBy('p.name')
      .execute();
    return rows.map((row) => ({ productId: row.id, name: row.name, unit: row.unit, parts: Number(row.parts) }));
  }

  async recipe(productId: number): Promise<RecipePartDto[]> {
    return recipeOf(this.db, productId);
  }

  /** Replaces what the product is made from; an empty list makes it an ordinary product again. */
  async setRecipe(productId: number, parts: Array<{ productId: number; quantity: number }>, actorId: number): Promise<RecipePartDto[]> {
    await this.transactions.run(async (repos) => {
      await assertOn(repos);
      const product = await repos.products.findById(productId, true);
      if (!product) throw new NotFoundError(`Product ${productId} does not exist`);
      const ids = parts.map((part) => part.productId);
      if (new Set(ids).size !== ids.length) throw new ValidationError('parts: each product goes in once');
      if (ids.includes(productId)) throw new ValidationError(`parts: ${product.name} can't be made from itself`);
      for (const part of parts) {
        const found = await repos.products.findById(part.productId, true);
        if (!found) throw new ValidationError(`parts: product ${part.productId} does not exist`);
        if (await madeFrom(repos.db, part.productId, productId)) throw new ValidationError(`parts: ${found.name} is itself made from ${product.name}`);
      }
      await repos.db.deleteFrom('recipe_parts').where('product_id', '=', productId).execute();
      if (parts.length > 0) {
        await repos.db
          .insertInto('recipe_parts')
          .values(parts.map((part, position) => ({ product_id: productId, part_id: part.productId, quantity: part.quantity, position })))
          .execute();
      }
      await repos.activityLog.create({
        userId: actorId,
        action: 'recipe.updated',
        entityType: 'product',
        entityId: productId,
        say: { key: 'recipeChanged', params: { product: product.name, parts: parts.length } },
        details: { parts },
      });
    });
    return this.recipe(productId);
  }

  /** What a Make would take and cost, before it is saved. */
  async plan(input: { productId: number; quantity: number; locationId?: number | null }): Promise<MakePlanDto> {
    return this.transactions.run((repos) => planMake(repos, input));
  }

  async list(range: DateRange): Promise<MakeDto[]> {
    const { from, to } = zonedDays(range, this.timeZone);
    const rows = await this.query().where('m.day', '>=', from).where('m.day', '<=', to).orderBy('m.day', 'desc').orderBy('m.id', 'desc').execute();
    return rows.map(toDto);
  }

  async get(id: number): Promise<MakeDto> {
    const row = await this.query().where('m.id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundError(`Make ${id} does not exist`);
    const lines = await this.db
      .selectFrom('make_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['l.product_id', 'p.name', 'p.unit', 'l.quantity', 'l.unit_cost'])
      .where('l.make_id', '=', id)
      .orderBy('l.id')
      .execute();
    return {
      ...toDto(row),
      lines: lines.map((line) => ({ productId: line.product_id, productName: line.name, unit: line.unit, quantity: line.quantity, unitCost: Number(line.unit_cost) })),
    };
  }

  async create(input: NewMakeInput, actorId: number, now = new Date()): Promise<MakeDto> {
    if (input.day > zonedDay(now, this.timeZone)) throw new ValidationError("day: a Make can't be for a day that hasn't happened yet");
    const id = await this.transactions.run(async (repos) => {
      await assertOn(repos);
      await assertMonthsOpen(repos.periods, [input.day]);
      const plan = await planMake(repos, input);
      if (plan.noCost.length > 0) throw new ValidationError(`Set the cost of ${plan.noCost.join(', ')} first, so the made product gets a true cost`);
      const product = (await repos.products.findById(input.productId, true))!;
      const year = Number(input.day.slice(0, 4));
      const number = formatNumber((await readRules(repos.settings)).numbering.make, year, await repos.documents.nextNumber('make', year));
      const costBefore = product.cost_price === null ? null : Number(product.cost_price);
      const made = await repos.db
        .insertInto('makes')
        .values({
          number,
          product_id: product.id,
          quantity: input.quantity,
          unit_cost: plan.unitCost!,
          cost_before: costBefore,
          day: input.day,
          location_id: plan.locationId,
          expires_on: input.expiresOn ?? null,
          note: input.note,
          created_by: actorId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const part of plan.parts) {
        await repos.db.insertInto('make_lines').values({ make_id: made.id, product_id: part.productId, quantity: part.needed, unit_cost: part.cost! }).execute();
        const partRow = await repos.products.findById(part.productId, true);
        await applyStockChange(repos, {
          productId: part.productId,
          productName: part.name,
          delta: -part.needed,
          reason: SYSTEM_STOCK_REASONS.MAKE,
          notes: number,
          adjustedBy: actorId,
          reorderLevel: partRow?.reorder_level ?? 10,
          locationId: plan.locationId,
        });
      }
      await applyStockChange(repos, {
        productId: product.id,
        productName: product.name,
        delta: input.quantity,
        reason: SYSTEM_STOCK_REASONS.MAKE,
        notes: number,
        adjustedBy: actorId,
        reorderLevel: product.reorder_level ?? 10,
        locationId: plan.locationId,
      });
      await changeCost(repos, { productId: product.id, productName: product.name, from: costBefore, to: plan.unitCost, actorId, because: { made: number } });
      const dated = Math.floor(input.quantity);
      if (input.expiresOn && dated > 0) {
        await repos.expiry.add({ productId: product.id, quantity: dated, expiresOn: input.expiresOn, note: number, orderLineId: null, createdBy: actorId });
      }
      await repos.activityLog.create({
        userId: actorId,
        action: 'make.created',
        entityType: 'make',
        entityId: made.id,
        say: { key: 'madeSaved', params: { number, quantity: input.quantity, product: product.name } },
        details: { number, productId: product.id, quantity: input.quantity, unitCost: plan.unitCost, day: input.day },
      });
      return made.id;
    });
    return this.get(id);
  }

  /** Puts the parts back and takes the made units out; refused once they have been sold. */
  async void(id: number, actorId: number, now = new Date()): Promise<MakeDto> {
    const make = await this.get(id);
    if (make.voidedAt) throw new ConflictError(`${make.number} is already voided`);
    await this.transactions.run(async (repos) => {
      await assertMonthsOpen(repos.periods, [make.day]);
      const marked = await repos.db.updateTable('makes').set({ voided_at: now, voided_by: actorId }).where('id', '=', id).where('voided_at', 'is', null).executeTakeFirst();
      if (Number(marked.numUpdatedRows) === 0) throw new ConflictError(`${make.number} is already voided`);
      const product = await repos.products.findById(make.productId, true);
      try {
        await applyStockChange(repos, {
          productId: make.productId,
          productName: make.productName,
          delta: -make.quantity,
          reason: SYSTEM_STOCK_REASONS.MAKE,
          notes: `${make.number} voided`,
          adjustedBy: actorId,
          reorderLevel: product?.reorder_level ?? 10,
          locationId: make.locationId,
        });
      } catch (error) {
        if (error instanceof ValidationError) throw new ConflictError(`Some of the ${make.quantity} × ${make.productName} from ${make.number} are already sold, so it can't be voided`);
        throw error;
      }
      for (const line of make.lines ?? []) {
        const part = await repos.products.findById(line.productId, true);
        await applyStockChange(repos, {
          productId: line.productId,
          productName: line.productName,
          delta: line.quantity,
          reason: SYSTEM_STOCK_REASONS.MAKE,
          notes: `${make.number} voided`,
          adjustedBy: actorId,
          reorderLevel: part?.reorder_level ?? 10,
          locationId: make.locationId,
        });
      }
      // The cost goes back to what it was, unless something has set it since.
      const row = await repos.db.selectFrom('makes').select('cost_before').where('id', '=', id).executeTakeFirstOrThrow();
      const current = product?.cost_price === null || product?.cost_price === undefined ? null : Number(product.cost_price);
      if (current === make.unitCost) {
        await changeCost(repos, { productId: make.productId, productName: make.productName, from: current, to: row.cost_before === null ? null : Number(row.cost_before), actorId, because: { unmade: make.number } });
      }
      await repos.activityLog.create({
        userId: actorId,
        action: 'make.voided',
        entityType: 'make',
        entityId: id,
        say: { key: 'makeVoided', params: { number: make.number } },
        details: { number: make.number },
      });
    });
    return this.get(id);
  }

  private query() {
    return this.db
      .selectFrom('makes as m')
      .innerJoin('products as p', 'p.id', 'm.product_id')
      .leftJoin('users as c', 'c.id', 'm.created_by')
      .leftJoin('users as v', 'v.id', 'm.voided_by')
      .leftJoin('stock_locations as loc', 'loc.id', 'm.location_id')
      .select([
        'm.id',
        'm.number',
        'm.product_id',
        'p.name as product_name',
        'p.unit',
        'm.quantity',
        'm.unit_cost',
        sql<string>`to_char(m.day, 'YYYY-MM-DD')`.as('day'),
        'm.location_id',
        'loc.name as location_name',
        sql<string | null>`to_char(m.expires_on, 'YYYY-MM-DD')`.as('expires_on'),
        'm.note',
        'c.name as created_by_name',
        'm.created_at',
        'm.voided_at',
        'v.name as voided_by_name',
      ]);
  }
}

type Row = Awaited<ReturnType<ReturnType<MakeService['query']>['executeTakeFirstOrThrow']>>;

function toDto(row: Row): MakeDto {
  const unitCost = Number(row.unit_cost);
  return {
    id: row.id,
    number: row.number,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    quantity: row.quantity,
    unitCost,
    value: roundMoney(unitCost * row.quantity),
    day: row.day,
    locationId: row.location_id,
    locationName: row.location_name,
    expiresOn: row.expires_on,
    note: row.note,
    createdBy: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    voidedAt: row.voided_at?.toISOString() ?? null,
    voidedBy: row.voided_by_name,
  };
}

async function assertOn(repos: TransactionalRepositories): Promise<void> {
  if (!(await readRules(repos.settings)).features.recipes) throw new ValidationError('Made products are switched off in Settings');
}

async function recipeOf(db: DatabaseClient, productId: number): Promise<RecipePartDto[]> {
  const rows = await db
    .selectFrom('recipe_parts as r')
    .innerJoin('products as p', 'p.id', 'r.part_id')
    .select(['r.part_id', 'p.name', 'p.unit', 'r.quantity', 'p.cost_price'])
    .where('r.product_id', '=', productId)
    .orderBy('r.position')
    .execute();
  return rows.map((row) => ({ productId: row.part_id, name: row.name, unit: row.unit, quantity: row.quantity, cost: row.cost_price === null ? null : Number(row.cost_price) }));
}

/** Whether `productId` is made, at any depth, from `partId`. */
async function madeFrom(db: DatabaseClient, productId: number, partId: number): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`
    with recursive tree(id) as (
      select part_id from recipe_parts where product_id = ${productId}
      union
      select r.part_id from recipe_parts r join tree t on r.product_id = t.id
    )
    select exists (select 1 from tree where id = ${partId}) as found
  `.execute(db);
  return rows[0]?.found ?? false;
}

async function planMake(repos: TransactionalRepositories, input: { productId: number; quantity: number; locationId?: number | null }): Promise<MakePlanDto> {
  const product = await repos.products.findById(input.productId, true);
  if (!product) throw new NotFoundError(`Product ${input.productId} does not exist`);
  if (!Number.isInteger(input.quantity) && !allowsParts(product.unit)) throw new ValidationError(`${product.name} is made by the piece: use a whole number`);
  const recipe = await recipeOf(repos.db, product.id);
  if (recipe.length === 0) throw new ValidationError(`${product.name} has no recipe yet: say what it is made from first`);
  const locationId = await pickLocation(repos, input.locationId, 'out');
  const location = await repos.locations.findById(locationId);
  const parts: MakePlanPartDto[] = [];
  for (const part of recipe) {
    const needed = roundQuantity(part.quantity * input.quantity);
    if (!Number.isInteger(needed) && !allowsParts(part.unit as never)) {
      throw new ValidationError(`${input.quantity} × ${product.name} would take ${needed} × ${part.name}, which is sold by the piece`);
    }
    const held = await repos.db.selectFrom('location_stock').select(['location_id', 'quantity']).where('product_id', '=', part.productId).execute();
    parts.push({
      ...part,
      needed,
      atLocation: held.find((row) => row.location_id === locationId)?.quantity ?? 0,
      inStock: roundQuantity(held.reduce((sum, row) => sum + row.quantity, 0)),
    });
  }
  const noCost = parts.filter((part) => part.cost === null).map((part) => part.name);
  const expiry = await repos.db
    .selectFrom('expiry_dates')
    .select(sql<string | null>`to_char(min(expires_on), 'YYYY-MM-DD')`.as('earliest'))
    .where('product_id', 'in', parts.map((part) => part.productId))
    .where('cleared_at', 'is', null)
    .executeTakeFirst();
  return {
    productId: product.id,
    productName: product.name,
    unit: product.unit,
    quantity: input.quantity,
    locationId,
    locationName: location?.name ?? '',
    parts,
    unitCost: noCost.length > 0 ? null : roundMoney(parts.reduce((sum, part) => sum + part.quantity * part.cost!, 0)),
    noCost,
    short: parts.filter((part) => part.inStock < part.needed).map((part) => part.name),
    earliestExpiry: expiry?.earliest ?? null,
  };
}
