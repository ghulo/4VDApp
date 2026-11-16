// Sends dashboard crashes to Sentry, grouped and with a stack trace. Off unless
// VITE_SENTRY_DSN is set at build time; Sentry's code then loads on its own after
// the page, so it never slows the first paint. Personal data never leaves: no
// users, query strings, console lines or click text, and email addresses are masked.
import type { Breadcrumb, ErrorEvent } from '@sentry/react'

type Sentry = typeof import('@sentry/react')

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
let sentry: Sentry | null = null
/** Errors caught before Sentry finished loading. */
const waiting: unknown[] = []

export function maskText(text: string): string {
  return text.replace(EMAIL, '[email]')
}

export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Console lines and typed text can hold anything.
  if (breadcrumb.category === 'console' || breadcrumb.category === 'ui.input') return null
  const data = breadcrumb.data ? { ...breadcrumb.data } : undefined
  if (data) {
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = stripQuery(data[key])
    }
  }
  return { ...breadcrumb, message: breadcrumb.message ? maskText(breadcrumb.message) : undefined, data }
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user
  delete event.extra
  if (event.request) event.request = { url: event.request.url ? stripQuery(event.request.url) : undefined }
  if (event.message) event.message = maskText(event.message)
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = maskText(exception.value)
  }
  event.breadcrumbs = (event.breadcrumbs ?? []).map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null)
  return event
}

export function startErrorTracking(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return
  void import('@sentry/react').then((loaded) => {
    loaded.init({
      dsn,
      environment: import.meta.env.MODE,
      release: (import.meta.env.VITE_RELEASE as string | undefined) || undefined,
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
      // Errors only: no tracing, no session replay.
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    })
    sentry = loaded
    for (const error of waiting.splice(0)) loaded.captureException(error)
  })
}

/** Reports a page that crashed while drawing (the ErrorBoundary). */
export function reportError(error: unknown): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return
  if (sentry) sentry.captureException(error)
  else if (waiting.length < 10) waiting.push(error)
}
