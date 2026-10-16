export interface PaginationMeta {
  page: number;
  total: number;
  limit: number;
  /** Sums over every matching record, not just this page (a list's totals row). */
  totals?: Record<string, number>;
}

/** Shape every endpoint returns. */
export interface ApiResponse<TData> {
  success: boolean;
  data: TData | null;
  message: string;
  error: string | null;
  meta?: PaginationMeta;
}
