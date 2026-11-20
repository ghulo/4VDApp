import { readViewAs } from '../auth/viewAs';
import type { PaginationMeta } from './types';

/** Shape every backend endpoint returns (backend/src/types/api.ts). */
interface ApiResponse<TData> {
  success: boolean;
  data: TData;
  message: string;
  error: string | null;
  meta?: PaginationMeta;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// The sign-in itself lives in httpOnly cookies the API sets: page scripts
// can't read them, so a script slipped into a page can't steal the session.
// The browser only keeps a note that someone is signed in, to skip asking
// the server on a page nobody has signed in to.
const SIGNED_IN_KEY = '4vd.signedIn';
// Where sign-ins used to be kept, before the cookies (moved once, then deleted).
const OLD_TOKEN_KEY = '4vd.accessToken';
const OLD_REFRESH_KEY = '4vd.refreshToken';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const sessionHint = {
  get signedIn(): boolean {
    return readStorage(SIGNED_IN_KEY) === 'yes' || readStorage(OLD_REFRESH_KEY) !== null;
  },
  set(): void {
    try {
      localStorage.setItem(SIGNED_IN_KEY, 'yes');
    } catch {
      // Private window: the cookie still works, the page just asks the server each time.
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(SIGNED_IN_KEY);
      localStorage.removeItem(OLD_TOKEN_KEY);
      localStorage.removeItem(OLD_REFRESH_KEY);
    } catch {
      // Nothing stored to clear.
    }
  },
};

/**
 * A browser signed in before the cookies keeps its old refresh token: swap it
 * once for the cookies, so nobody is signed out by the change.
 */
export async function moveOldSignIn(): Promise<void> {
  const refreshToken = readStorage(OLD_REFRESH_KEY);
  if (!refreshToken) return;
  const response = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => null);
  // Unreachable: try again next time. Answered: the old token is spent either way.
  if (!response) return;
  try {
    localStorage.removeItem(OLD_TOKEN_KEY);
    localStorage.removeItem(OLD_REFRESH_KEY);
  } catch {
    // Nothing to remove.
  }
  if (response.ok) sessionHint.set();
}

/** Called when the session can't be refreshed, so the app can show the login page. */
let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

// Several requests can fail with 401 at once; share one refresh between them
// so the single-use refresh token is not spent twice.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  // The refresh cookie goes along by itself; the answer sets new cookies.
  refreshInFlight ??= fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** A file sent as-is (e.g. a photo), instead of JSON. */
  file?: Blob;
  /** The file's own name, kept with it (files on records). */
  fileName?: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** Ask as the signed-in person, even while the developer views 4VD as another role. */
  asMyself?: boolean;
  /**
   * Whose write this is (the Counter's sales and events): the server refuses it
   * (409 OWNER_CHANGED) when someone else is signed in by the time it arrives,
   * a resend after a refreshed sign-in included.
   */
  expectOwner?: { businessId: number; userId: number };
  /** Stops the request (a timeout). It may still have reached the server: treat it as no answer, never as a no. */
  signal?: AbortSignal;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const url = new URL(`${API_URL}/api${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    'Content-Type': options.file ? options.file.type || 'application/octet-stream' : 'application/json',
  };
  const viewAs = options.asMyself ? null : readViewAs();
  if (viewAs) headers['X-View-As'] = viewAs;
  if (options.fileName) headers['X-File-Name'] = encodeURIComponent(options.fileName);
  if (options.expectOwner) headers['X-Expect-Owner'] = `${options.expectOwner.businessId}:${options.expectOwner.userId}`;

  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers,
      body: options.file ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(`Can't reach the server at ${API_URL}. Check that the backend is running.`, 0, 'NETWORK');
  }
}

/** Send a request, refreshing the session once if the access token expired. */
async function sendWithRefresh(path: string, options: RequestOptions): Promise<Response> {
  let response = await send(path, options);
  if (response.status === 401 && sessionHint.signedIn && !path.startsWith('/auth/')) {
    // Stopped meanwhile (a timeout): no second copy goes out.
    if (options.signal?.aborted) return response;
    if (await refreshSession()) {
      response = await send(path, options);
    } else {
      sessionHint.clear();
      onSessionExpired();
    }
  }
  return response;
}

function toApiError(response: Response, body: ApiResponse<unknown> | null): ApiError {
  return new ApiError(
    body?.message ?? `The server answered with status ${response.status}`,
    response.status,
    body?.error ?? null,
  );
}

export async function apiRequest<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: TData; meta?: PaginationMeta }> {
  const response = await sendWithRefresh(path, options);
  const body = (await response.json().catch(() => null)) as ApiResponse<TData> | null;
  // Stopped while the answer was on its way: no answer, whatever the status said.
  if (!body && options.signal?.aborted) throw new ApiError('The server did not answer in time', 0, 'NETWORK');
  if (!response.ok || !body?.success) throw toApiError(response, body);
  return { data: body.data, meta: body.meta };
}

/** Fetch a file (e.g. a CSV export) through the authenticated API. */
export async function apiDownload(
  path: string,
  query: RequestOptions['query'] = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await sendWithRefresh(path, { query });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;
    throw toApiError(response, body);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  // A name with accents comes encoded as filename*=UTF-8''…; prefer it.
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const filename = encoded ? decodeURIComponent(encoded) : (/filename="([^"]+)"/.exec(disposition)?.[1] ?? null);
  return { blob: await response.blob(), filename };
}

/** Hand a downloaded file to the browser to save. */
export function saveDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // Some Safari and Firefox versions ignore clicks on detached links, or cancel
  // the download if the URL is revoked straight away.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Full address of an uploaded picture, from the path the API gives (e.g. /api/media/…). */
export function mediaSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  // Uploaded pictures live on the API; an outside link is used as it is.
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
}
