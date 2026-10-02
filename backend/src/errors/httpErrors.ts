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

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}
