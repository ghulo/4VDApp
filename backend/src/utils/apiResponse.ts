import type { Response } from 'express';
import type { ApiResponse, PaginationMeta } from '../types/api.js';

interface SuccessOptions {
  message?: string;
  meta?: PaginationMeta;
  statusCode?: number;
}

export function sendSuccess<TData>(res: Response, data: TData, options: SuccessOptions = {}): void {
  const body: ApiResponse<TData> = {
    success: true,
    data,
    message: options.message ?? 'OK',
    error: null,
    ...(options.meta && { meta: options.meta }),
  };
  res.status(options.statusCode ?? 200).json(body);
}

export function sendError(res: Response, statusCode: number, error: string, message: string): void {
  const body: ApiResponse<null> = {
    success: false,
    data: null,
    message,
    error,
  };
  res.status(statusCode).json(body);
}
