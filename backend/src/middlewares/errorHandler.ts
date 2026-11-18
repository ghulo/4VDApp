import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/httpErrors.js';
import { isEmailTaken } from '../repositories/UserRepository.js';
import { sendError } from '../utils/apiResponse.js';
import { captureError, stripQuery } from '../utils/errorTracking.js';
import { logger } from '../utils/logger.js';

// Express only treats a middleware as an error handler when it declares all
// four parameters, so `_next` has to stay even though it is unused.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    sendError(res, err.statusCode, err.code, err.message);
    return;
  }

  // Two accounts never share an email; whatever path tried, it is a clear 409, not a 500.
  if (isEmailTaken(err)) {
    sendError(res, 409, 'EMAIL_TAKEN', 'That email already has a 4VD account. Log in with it instead.');
    return;
  }

  // Errors from Express's body readers (bad JSON, uploads over the limit).
  const bodyError = err as { type?: string; status?: number };
  if (bodyError.type === 'entity.too.large') {
    sendError(res, 413, 'TOO_LARGE', 'That file is too big. Use one under 5 MB.');
    return;
  }
  if (bodyError.type === 'entity.parse.failed') {
    sendError(res, 400, 'BAD_REQUEST', 'The request body is not valid JSON');
    return;
  }

  logger.error('Unhandled error', {
    method: req.method,
    path: req.originalUrl,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  captureError(err, { method: req.method, path: stripQuery(req.originalUrl) });
  // Never leak internal details to the client.
  sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong on our side');
}
