import { expect, request, type APIRequestContext } from '@playwright/test';

/** Talks to the e2e API directly: to seed data and to read the books back to the cent. */
export const API_URL = 'http://localhost:3100';

export const USERS = {
  admin: { email: 'demo-admin@4vd.local', password: 'demo-admin-4vd' },
  owner: { email: 'e2e-owner@4vd.local', password: 'e2e-owner-4vd' },
  accountant: {
    email: 'demo-accountant@4vd.local',
    password: 'demo-accountant-4vd',
  },
} as const;

export interface Api {
  get<T = any>(path: string): Promise<T>;
  post<T = any>(path: string, body?: unknown): Promise<T>;
  put<T = any>(path: string, body?: unknown): Promise<T>;
  dispose(): Promise<void>;
}

export async function apiAs(user: keyof typeof USERS): Promise<Api> {
  const context: APIRequestContext = await request.newContext({
    baseURL: API_URL,
  });
  const login = await context.post('/api/auth/login', { data: USERS[user] });
  expect(login.status(), await login.text()).toBe(200);
  const body = await login.json();
  const token: string = body.data.accessToken ?? body.data.token;
  const headers = { Authorization: `Bearer ${token}` };
  const call = async (method: 'get' | 'post' | 'put', path: string, data?: unknown) => {
    const response = await context[method](path, {
      headers,
      data: data ?? (method === 'get' ? undefined : {}),
    });
    expect(response.ok(), `${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  return {
    get: (path) => call('get', path),
    post: (path, body) => call('post', path, body),
    put: (path, body) => call('put', path, body),
    dispose: () => context.dispose(),
  };
}

/** A seeded product by its code, with its stock and cost. */
export async function productBySku(api: Api, sku: string): Promise<{ id: number; costPrice: number; stock: { quantity: number } }> {
  const found = await api.get(`/api/products?search=${encodeURIComponent(sku)}`);
  const list = (Array.isArray(found) ? found : found.products) as Array<{
    id: number;
    sku: string;
  }>;
  const product = list.find((one) => one.sku === sku);
  if (!product) throw new Error(`No product ${sku}`);
  return api.get(`/api/products/${product.id}`);
}

/** Today in the shop's time zone, "2026-11-16". */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date());
export const thisMonth = () => today().slice(0, 7);
export const lastMonth = () => {
  const [year, month] = thisMonth().split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};

/** Closing balances by account number for a period, e.g. { '1110': 100, '2340': -15.25 }. */
export async function balances(api: Api, from: string, to = '2100-12-31'): Promise<Record<string, number>> {
  const data = await api.get(`/api/books/trial-balance?from=${from}&to=${to}`);
  return Object.fromEntries(
    data.rows.filter((row: { closing: number }) => row.closing !== 0).map((row: { number: string; closing: number }) => [row.number, row.closing]),
  );
}

/** Book entries posted for one document. */
export async function entriesFor(api: Api, source: string, id: number) {
  return (await api.get(`/api/books/entries?source=${source}&id=${id}`)) as Array<{
    kind: string;
    reversed: boolean;
    lines: Array<{ accountNumber: string; debit: number; credit: number }>;
  }>;
}

/** An entry's lines as sorted "1110 Dr 100" strings. */
export const readLines = (entry: { lines: Array<{ accountNumber: string; debit: number; credit: number }> }) =>
  entry.lines.map((line) => `${line.accountNumber} ${line.debit > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}`).sort();
