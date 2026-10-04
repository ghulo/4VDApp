// Thin wrapper so we can swap in a real logger (pino, Sentry breadcrumbs)
// later without touching every call site.
type LogContext = Record<string, unknown>;
type ErrorListener = (message: string, context?: LogContext) => void;

let errorListener: ErrorListener | null = null;

export const logger = {
  info(message: string, context?: LogContext): void {
    console.info(JSON.stringify({ level: 'info', message, ...context }));
  },
  warn(message: string, context?: LogContext): void {
    console.warn(JSON.stringify({ level: 'warn', message, ...context }));
  },
  error(message: string, context?: LogContext): void {
    console.error(JSON.stringify({ level: 'error', message, ...context }));
    errorListener?.(message, context);
  },
  /** Hears every error logged from now on (the server uses it to email the developer). Null stops it. */
  onError(listener: ErrorListener | null): void {
    errorListener = listener;
  },
};
