export interface PaginationMeta {
  page: number;
  total: number;
  limit: number;
}

/** Shape every endpoint returns, as described in docs/API.md. */
export interface ApiResponse<TData> {
  success: boolean;
  data: TData | null;
  message: string;
  error: string | null;
  meta?: PaginationMeta;
}
