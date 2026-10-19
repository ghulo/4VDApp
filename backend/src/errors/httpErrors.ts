/**
 * Base class for errors that map to an HTTP response. Anything thrown that is
 * not an AppError is treated as an unexpected 500 by the error handler.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this') {
    super(message, 403, 'FORBIDDEN');
  }
}

/** The developer is looking at 4VD as another role: they can look around, but nothing is saved. */
export class ViewingAsError extends AppError {
  constructor(role: string) {
    super(`You are viewing 4VD as ${role}: nothing is saved while you look around`, 403, 'VIEWING_AS');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND');
  }
}

/** The AI service is switched off, over its free limit, or not answering. */
export class AiUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 503, 'AI_UNAVAILABLE');
  }
}

/** A link that worked once but no longer does: used, cancelled or expired. */
export class GoneError extends AppError {
  constructor(message: string) {
    super(message, 410, 'GONE');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}
