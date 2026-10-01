import type { PaginationMeta } from '../types/api.js';

export interface PageRequest {
  page: number;
  limit: number;
}

export function toOffset({ page, limit }: PageRequest): number {
  return (page - 1) * limit;
}

export function toPaginationMeta({ page, limit }: PageRequest, total: number): PaginationMeta {
  return { page, limit, total };
}

export interface Paginated<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}
