import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/httpErrors.js';
import { sendError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

// Express only treats a middleware as an error handler when it declares all
// four parameters, so `_next` has to stay even though it is unused.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    sendError(res, err.statusCode, err.code, err.message);
    return;
  }

  logger.error('Unhandled error', {
    method: req.method,
    path: req.originalUrl,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  // Never leak internal details to the client.
  sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong on our side');
}
