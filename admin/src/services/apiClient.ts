import type { PaginationMeta } from './types';

/** Shape every backend endpoint returns, see docs/API.md. */
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

// Tokens live in localStorage so a page refresh keeps you logged in. The
// admin dashboard is only used by trusted staff on their own devices.
const TOKEN_KEY = '4vd.accessToken';
const REFRESH_KEY = '4vd.refreshToken';

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  save(token: string, refreshToken: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Called when the session can't be refreshed, so the app can show the login page. */
let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

// Several requests can fail with 401 at once; share one refresh between them
// so the single-use refresh token is not spent twice.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;

  refreshInFlight ??= fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then(async (response) => {
      if (!response.ok) return false;
      const body = (await response.json()) as ApiResponse<{ token: string; refreshToken: string }>;
      tokenStore.save(body.data.token, body.data.refreshToken);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const url = new URL(`${API_URL}/api${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tokenStore.access) headers.Authorization = `Bearer ${tokenStore.access}`;

  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(`Can't reach the server at ${API_URL}. Check that the backend is running.`, 0, 'NETWORK');
  }
}

/** Calls the API, refreshing the session once if the access token expired. */
export async function apiRequest<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: TData; meta?: PaginationMeta }> {
  let response = await send(path, options);

  if (response.status === 401 && tokenStore.refresh && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      response = await send(path, options);
    } else {
      tokenStore.clear();
      onSessionExpired();
    }
  }

  const body = (await response.json().catch(() => null)) as ApiResponse<TData> | null;
  if (!response.ok || !body?.success) {
    throw new ApiError(
      body?.message ?? `The server answered with status ${response.status}`,
      response.status,
      body?.error ?? null,
    );
  }
  return { data: body.data, meta: body.meta };
}
