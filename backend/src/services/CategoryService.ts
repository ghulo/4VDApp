import { ConflictError, NotFoundError } from '../errors/httpErrors.js';
import type { CategoryRepository } from '../repositories/CategoryRepository.js';
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
  constructor(private readonly categoryRepository: CategoryRepository) {}

  async list(): Promise<CategoryDto[]> {
    const categories = await this.categoryRepository.findAll();
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      productCount: category.product_count,
    }));
  }

  async create(input: CategoryInput): Promise<CategoryDto> {
    await this.ensureNameIsFree(input.name);
    try {
      const category = await this.categoryRepository.create(input);
      return { id: category.id, name: category.name, description: category.description };
    } catch (error) {
      // Two admins creating the same name at once: the unique index catches it.
      if (isUniqueViolation(error)) throw this.duplicateNameError(input.name);
      throw error;
    }
  }

  async update(id: number, input: CategoryInput): Promise<CategoryDto> {
    await this.ensureNameIsFree(input.name, id);
    try {
      const category = await this.categoryRepository.update(id, input);
      if (!category) throw new NotFoundError(`Category ${id} does not exist`);
      return { id: category.id, name: category.name, description: category.description };
    } catch (error) {
      if (isUniqueViolation(error)) throw this.duplicateNameError(input.name);
      throw error;
    }
  }

  /** Refuses while products still use it, so no product is left without a category. */
  async delete(id: number): Promise<void> {
    const category = await this.categoryRepository.findById(id);
    if (!category) throw new NotFoundError(`Category ${id} does not exist`);

    const productCount = await this.categoryRepository.countProducts(id);
    if (productCount > 0) {
      throw new ConflictError(
        `"${category.name}" still has ${productCount} product(s). Move or delete them first.`,
      );
    }
    await this.categoryRepository.softDelete(id);
  }

  private async ensureNameIsFree(name: string, exceptId?: number): Promise<void> {
    const existing = await this.categoryRepository.findByName(name);
    if (existing && existing.id !== exceptId) throw this.duplicateNameError(name);
  }

  private duplicateNameError(name: string): ConflictError {
    return new ConflictError(`A category named "${name}" already exists`);
  }
}
