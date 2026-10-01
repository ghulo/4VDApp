import * as SecureStore from 'expo-secure-store';
import type { PaginationMeta } from './types';

interface ApiResponse<TData> {
  success: boolean;
  data: TData;
  message: string;
  error: string | null;
  meta?: PaginationMeta;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Expo inlines EXPO_PUBLIC_* variables at build time.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const TOKEN_KEY = 'fourvd.accessToken';
const REFRESH_KEY = 'fourvd.refreshToken';

/**
 * Tokens live in the phone's secure storage (Keychain / Keystore). They are
 * also cached in memory because secure storage reads are async and slow.
 */
let accessToken: string | null = null;
let refreshToken: string | null = null;

export const tokenStore = {
  async load(): Promise<boolean> {
    [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    return accessToken !== null;
  },
  get refresh(): string | null {
    return refreshToken;
  },
  async save(token: string, refresh: string): Promise<void> {
    accessToken = token;
    refreshToken = refresh;
    await Promise.all([SecureStore.setItemAsync(TOKEN_KEY, token), SecureStore.setItemAsync(REFRESH_KEY, refresh)]);
  },
  async clear(): Promise<void> {
    accessToken = null;
    refreshToken = null;
    await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(REFRESH_KEY)]);
  },
};

let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

// Refresh tokens are single-use, so parallel 401s must share one refresh.
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  const current = refreshToken;
  if (!current) return Promise.resolve(false);

  refreshInFlight ??= fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current }),
  })
    .then(async (response) => {
      if (!response.ok) return false;
      const body = (await response.json()) as ApiResponse<{ token: string; refreshToken: string }>;
      await tokenStore.save(body.data.token, body.data.refreshToken);
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
  const queryString = Object.entries(options.query ?? {})
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const url = `${API_URL}/api${path}${queryString ? `?${queryString}` : ''}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(`Can't reach the server at ${API_URL}. Check your connection and the API address.`, 0);
  }
}

export async function apiRequest<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: TData; meta?: PaginationMeta }> {
  let response = await send(path, options);

  if (response.status === 401 && refreshToken && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      response = await send(path, options);
    } else {
      await tokenStore.clear();
      onSessionExpired();
    }
  }

  const body = (await response.json().catch(() => null)) as ApiResponse<TData> | null;
  if (!response.ok || !body?.success) {
    throw new ApiError(body?.message ?? `The server answered with status ${response.status}`, response.status);
  }
  return { data: body.data, meta: body.meta };
}
