import type { UserRole } from '../database/types.js';
import { NotFoundError } from '../errors/httpErrors.js';
import type { FavoriteRepository } from '../repositories/FavoriteRepository.js';
import type { ProductRepository } from '../repositories/ProductRepository.js';
import type { ProductDto, ProductService } from './ProductService.js';

export class FavoriteService {
  constructor(
    private readonly favoriteRepository: FavoriteRepository,
    private readonly productRepository: ProductRepository,
    private readonly productService: ProductService,
  ) {}

  /** Favorited products, newest first. Hidden or deleted products drop out. */
  async list(userId: number, viewerRole: UserRole): Promise<ProductDto[]> {
    const productIds = await this.favoriteRepository.listProductIds(userId);
    return this.productService.getManyByIds(productIds, viewerRole);
  }

  async listIds(userId: number): Promise<number[]> {
    return this.favoriteRepository.listProductIds(userId);
  }

  async add(userId: number, productId: number): Promise<void> {
    const product = await this.productRepository.findById(productId, false);
    if (!product) throw new NotFoundError(`Product ${productId} does not exist`);
    await this.favoriteRepository.add(userId, productId);
  }

  remove(userId: number, productId: number): Promise<void> {
    return this.favoriteRepository.remove(userId, productId);
  }
}
