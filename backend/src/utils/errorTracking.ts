// Sends errors to Sentry with a stack trace, grouped, so a bug is one issue
// instead of a pile of emails. Off unless SENTRY_DSN is set.
// Personal data never leaves: no request bodies, cookies, auth headers, query
// strings, users or log lines, and any email address left in a text is masked.
import * as Sentry from '@sentry/node';
import type { ErrorEvent, Breadcrumb } from '@sentry/node';

type Context = Record<string, unknown>;

let enabled = false;

/** Keys whose values are always dropped, wherever they appear. */
const SECRET_KEY = /pass|pin|token|secret|auth|cookie|session|email|phone|name|address|nui|iban|card|note/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const REMOVED = '[removed]';

/** Masks email addresses in a text. */
export function maskText(text: string): string {
  return text.replace(EMAIL, '[email]');
}

/** Drops a query string: searches and links can carry names, codes and tokens. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** A copy with secret keys dropped and email addresses masked, a few levels deep. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 4) return REMOVED;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? REMOVED : scrubValue(item, depth + 1);
  }
  return out;
}

/** The last word on what is sent: strips the request, the user and any personal data. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.server_name;
  if (event.request) {
    event.request = {
      method: event.request.method,
      url: event.request.url ? stripQuery(event.request.url) : undefined,
    };
  }
  if (event.message) event.message = maskText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = maskText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Context;
  if (event.tags) event.tags = scrubValue(event.tags) as typeof event.tags;
  event.breadcrumbs = (event.breadcrumbs ?? []).map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  return event;
}

/** Console lines can hold anything, so they are dropped; other crumbs lose queries and data. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  const data = breadcrumb.data ? { ...breadcrumb.data } : undefined;
  if (data && typeof data.url === 'string') data.url = stripQuery(data.url);
  return {
    ...breadcrumb,
    message: breadcrumb.message ? maskText(breadcrumb.message) : undefined,
    data: data ? (scrubValue(data) as Breadcrumb['data']) : undefined,
  };
}

export function initErrorTracking(dsn: string | undefined, environment: string): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment,
    // Render sets this to the commit it is running.
    release: process.env.RENDER_GIT_COMMIT || undefined,
    // Collect nothing about people or requests (Sentry 11 collects all of it by default).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
    },
    // Errors only: no performance tracing, no profiling.
    tracesSampleRate: 0,
    maxValueLength: 2000,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    // server.ts catches crashes itself, reports them and restarts; Sentry must not do it twice.
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== 'OnUncaughtException' && i.name !== 'OnUnhandledRejection'),
  });
  enabled = true;
}

/** Reports a crashed request with its stack trace. */
export function captureError(error: unknown, context: Context = {}): void {
  if (!enabled) return;
  Sentry.captureException(error, { extra: scrubValue(context) as Context });
}

/** Logged errors that are already reported with their stack trace (errorHandler, server.ts crash). */
export const REPORTED_WITH_STACK = new Set(['Unhandled error', 'Unhandled promise rejection', 'Uncaught exception']);

/** Reports an error that was only logged (background jobs). Grouped by its message. */
export function captureLoggedError(message: string, context: Context = {}): void {
  if (!enabled || REPORTED_WITH_STACK.has(message)) return;
  const { error, stack, ...rest } = context;
  Sentry.captureMessage(message, {
    level: 'error',
    fingerprint: [message],
    extra: scrubValue({ error, stack, ...rest }) as Context,
  });
}

/** Waits up to two seconds for reports still on their way (on shutdown). */
export async function flushErrorTracking(): Promise<void> {
  if (enabled) await Sentry.flush(2000);
}
