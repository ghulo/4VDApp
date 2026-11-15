import { ConflictError, NotFoundError } from '../errors/httpErrors.js';
import type { Say } from '../i18n/activityText.js';
import type { LocationRecord, LocationRepository } from '../repositories/LocationRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';

export interface LocationDto {
  id: number;
  name: string;
  /** The till sells from here. */
  sellsHere: boolean;
  /** Goods come in here unless another location is picked. */
  receivesHere: boolean;
  /** Units of all products here. */
  units: number;
  /** Products with stock here. */
  products: number;
}

export interface ProductLocationDto {
  id: number;
  name: string;
  sellsHere: boolean;
  quantity: number;
  /** Below this where the till sells, it wants refilling from storage. */
  shelfMinimum: number | null;
}

const toDto = (row: LocationRecord): LocationDto => ({
  id: row.id,
  name: row.name,
  sellsHere: row.sells_here,
  receivesHere: row.receives_here,
  units: Number(row.units),
  products: row.products,
});

/**
 * Where stock is kept. A shop starts with one, "Shop floor"; the owner adds
 * storerooms. One location sells and one receives. A location goes only when
 * it is empty, and never the last one.
 */
export class LocationService {
  constructor(
    private readonly locations: LocationRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async list(): Promise<LocationDto[]> {
    return (await this.locations.list()).map(toDto);
  }

  async create(name: string, actorId: number): Promise<LocationDto> {
    const id = await this.transactions.run(async (repos) => {
      const id = await this.unique(() => repos.locations.create(name), name);
      await log(repos, actorId, id, { key: 'locationAdded', params: { name } });
      return id;
    });
    return toDto((await this.locations.findById(id))!);
  }

  async update(id: number, input: { name?: string; sellsHere?: true; receivesHere?: true }, actorId: number): Promise<LocationDto> {
    await this.transactions.run(async (repos) => {
      const location = await inUse(repos, id);
      if (input.name !== undefined && input.name !== location.name) {
        await this.unique(() => repos.locations.rename(id, input.name!), input.name);
        await log(repos, actorId, id, { key: 'locationRenamed', params: { from: location.name, to: input.name } });
      }
      if (input.sellsHere && !location.sells_here) {
        await repos.locations.setOnly(id, 'sells_here');
        await log(repos, actorId, id, { key: 'locationSells', params: { name: input.name ?? location.name } });
      }
      if (input.receivesHere && !location.receives_here) {
        await repos.locations.setOnly(id, 'receives_here');
        await log(repos, actorId, id, { key: 'locationReceives', params: { name: input.name ?? location.name } });
      }
    });
    return toDto((await this.locations.findById(id))!);
  }

  async remove(id: number, actorId: number, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      const location = await inUse(repos, id);
      if ((await repos.locations.countInUse()) <= 1) throw new ConflictError('The last location stays: stock has to be somewhere');
      if (location.sells_here) throw new ConflictError(`The till sells from ${location.name}. Choose another location to sell from first.`);
      if (location.receives_here) throw new ConflictError(`Goods come in to ${location.name}. Choose another location for them first.`);
      if (Number(location.units) > 0) {
        throw new ConflictError(`${location.name} still holds ${Number(location.units)} units. Move them out first.`);
      }
      await repos.locations.remove(id, now);
      await log(repos, actorId, id, { key: 'locationRemoved', params: { name: location.name } });
    });
  }

  async forProduct(productId: number): Promise<ProductLocationDto[]> {
    const rows = await this.locations.forProduct(productId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sellsHere: row.sells_here,
      quantity: Number(row.quantity),
      shelfMinimum: row.shelf_minimum,
    }));
  }

  async setShelfMinimum(productId: number, locationId: number, minimum: number | null): Promise<ProductLocationDto[]> {
    await this.transactions.run(async (repos) => {
      if (!(await repos.products.findById(productId, true))) throw new NotFoundError(`Product ${productId} does not exist`);
      await inUse(repos, locationId);
      await repos.locations.setShelfMinimum(productId, locationId, minimum);
    });
    return this.forProduct(productId);
  }

  private async unique<T>(run: () => Promise<T>, name: string): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError(`There is already a location called ${name}`);
      throw error;
    }
  }
}

async function inUse(repos: TransactionalRepositories, id: number): Promise<LocationRecord> {
  const location = await repos.locations.findById(id);
  if (!location || location.removed_at) throw new NotFoundError(`Location ${id} does not exist`);
  return location;
}

function log(repos: TransactionalRepositories, userId: number, id: number, say: Say) {
  return repos.activityLog.create({ userId, action: 'location.changed', entityType: 'stock_location', entityId: id, say });
}
