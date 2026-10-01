import { ConflictError, NotFoundError } from '../errors/httpErrors.js';
import type { CategoryRepository } from '../repositories/CategoryRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';

export interface CategoryDto {
  id: number;
  name: string;
  description: string | null;
  productCount?: number;
}

export interface CategoryInput {
  name: string;
  description: string | null;
}

export class CategoryService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async list(): Promise<CategoryDto[]> {
    const categories = await this.categoryRepository.findAll();
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      productCount: category.product_count,
    }));
  }

  async create(input: CategoryInput, actorId: number): Promise<CategoryDto> {
    await this.ensureNameIsFree(input.name);
    try {
      return await this.transactions.run(async (repos) => {
        const category = await repos.categories.create(input);
        await repos.activityLog.create({
          userId: actorId,
          action: 'category.created',
          entityType: 'category',
          entityId: category.id,
          summary: `Added category ${category.name}`,
        });
        return { id: category.id, name: category.name, description: category.description };
      });
    } catch (error) {
      // Two admins creating the same name at once: the unique index catches it.
      if (isUniqueViolation(error)) throw this.duplicateNameError(input.name);
      throw error;
    }
  }

  async update(id: number, input: CategoryInput, actorId: number): Promise<CategoryDto> {
    const existing = await this.categoryRepository.findById(id);
    if (!existing) throw new NotFoundError(`Category ${id} does not exist`);
    await this.ensureNameIsFree(input.name, id);

    try {
      return await this.transactions.run(async (repos) => {
        const category = await repos.categories.update(id, input);
        if (!category) throw new NotFoundError(`Category ${id} does not exist`);
        await repos.activityLog.create({
          userId: actorId,
          action: 'category.updated',
          entityType: 'category',
          entityId: id,
          summary:
            existing.name === category.name
              ? `Edited category ${category.name}`
              : `Renamed category ${existing.name} to ${category.name}`,
          details: { from: { name: existing.name, description: existing.description }, to: input },
        });
        return { id: category.id, name: category.name, description: category.description };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.duplicateNameError(input.name);
      throw error;
    }
  }

  /** Refuses while products still use it, so no product is left without a category. */
  async delete(id: number, actorId: number): Promise<void> {
    const category = await this.categoryRepository.findById(id);
    if (!category) throw new NotFoundError(`Category ${id} does not exist`);

    const productCount = await this.categoryRepository.countProducts(id);
    if (productCount > 0) {
      throw new ConflictError(`"${category.name}" still has ${productCount} product(s). Move or delete them first.`);
    }
    await this.transactions.run(async (repos) => {
      await repos.categories.softDelete(id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'category.deleted',
        entityType: 'category',
        entityId: id,
        summary: `Deleted category ${category.name}`,
      });
    });
  }

  private async ensureNameIsFree(name: string, exceptId?: number): Promise<void> {
    const existing = await this.categoryRepository.findByName(name);
    if (existing && existing.id !== exceptId) throw this.duplicateNameError(name);
  }

  private duplicateNameError(name: string): ConflictError {
    return new ConflictError(`A category named "${name}" already exists`);
  }
}
