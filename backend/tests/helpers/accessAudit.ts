import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listRoutes, recordMountPaths } from './routeList.js';

/**
 * The access audit: every API route, called as every kind of caller, must
 * refuse exactly the ones it should. The table below says, route by route,
 * who may get in. It is written by hand from what each screen is for, not
 * read from the route guards, so a guard that is missing or too loose shows
 * up here. A new route fails this test until it is added to the table.
 *
 * "Refused" means 401 or 403. Anything else (200, 400 for an empty body, 404
 * for an id that doesn't exist) means the caller got past the door. Calls
 * send empty bodies and ids that don't exist, so nothing real changes.
 */
recordMountPaths();
const { createTestUser, loginAs, resetData, setupTestApp } = await import('./testApp.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/utils/tokens.js');
const { RATE_LIMITS } = await import('../../src/constants/rateLimits.js');
/** Calls one app may take before a new one: below every rate limit, so a limit can never decide the answer. */
const CALLS_PER_APP = Math.min(...Object.values(RATE_LIMITS));
type TestContext = Awaited<ReturnType<typeof setupTestApp>>;

export const CALLERS = ['signedOut', 'portalCustomer', 'family', 'employee', 'accountant', 'owner', 'admin', 'developer'] as const;
export type Caller = (typeof CALLERS)[number];
const DASHBOARD_ROLES = ['family', 'employee', 'accountant', 'owner', 'admin', 'developer'] as const;

/** Who gets in, for each kind of route (Settings → Roles at its defaults). */
const WHO = {
  /** Sign-in pages, invites, product photos, health. */
  anyone: CALLERS,
  /** The portal's own sign-in: open to all; a dashboard session means nothing there. */
  portalOpen: CALLERS,
  /** Called by our own jobs with a secret, never by a person. */
  secret: [],
  /** A business customer's own portal. */
  portal: ['portalCustomer'],
  /** One's own account, the catalogue, notifications. */
  signedIn: DASHBOARD_ROLES,
  /** The working team: stock moves, makes, to-dos. Family only browse. */
  team: ['employee', 'accountant', 'owner', 'admin', 'developer'],
  /** The counter: selling, counts, deliveries. Never the accountant. */
  counter: ['employee', 'owner', 'admin', 'developer'],
  /** Customers and invoices: the counter for tabs, and the accountant. */
  counterOrAccountant: ['employee', 'accountant', 'owner', 'admin', 'developer'],
  /** The money side: books, VAT, bills, reports. */
  money: ['accountant', 'owner', 'admin', 'developer'],
  /** The whole business and its products, decisions on requests. */
  overseers: ['owner', 'admin', 'developer'],
  /** People, stock, settings. */
  managers: ['admin', 'developer'],
  /** Employees, pay and leave. */
  payroll: ['accountant', 'owner', 'developer'],
  /** Hand-written book entries, the opening balance, fixed assets. */
  entries: ['accountant', 'admin', 'developer'],
  /** Who from 4VD opened the business: the people who run it (main admin, admins). */
  leaders: ['admin', 'developer'],
  /** Roles, wiping data, restore points. */
  developer: ['developer'],
} satisfies Record<string, readonly Caller[]>;

const ACCESS: Record<keyof typeof WHO, string[]> = {
  anyone: [
    'POST /api/auth/two-step',
    'POST /api/auth/passkey/options',
    'POST /api/auth/passkey',
    'POST /api/auth/two-step/passkey/options',
    'POST /api/auth/two-step/passkey',
    'POST /api/auth/two-step/setup/start',
    'POST /api/auth/two-step/setup/confirm',
    'GET /health/',
    'POST /api/auth/login',
    'POST /api/auth/refresh',
    'GET /api/auth/invites/:token',
    'POST /api/auth/invites/:token/accept',
    'GET /api/auth/google',
    'POST /api/auth/google',
    'POST /api/auth/invites/:token/google',
    'POST /api/auth/signup',
    'POST /api/auth/forgot-password',
    'POST /api/auth/reset-password',
    'POST /api/auth/resend-verification',
    'POST /api/auth/verify-email',
    'POST /api/auth/confirm-email-change',
    'GET /api/media/:id',
    'GET /api/brand/:shortName',
  ],
  portalOpen: [
    'POST /api/portal/links',
    'POST /api/portal/links/peek',
    'POST /api/portal/links/use',
    'POST /api/portal/sign-out',
  ],
  secret: [
    'POST /api/internal/backup-ok',
    'POST /api/internal/bill-email',
  ],
  portal: [
    'GET /api/portal/me',
    'PUT /api/portal/me/language',
    'GET /api/portal/products',
    'POST /api/portal/quote',
    'GET /api/portal/orders',
    'POST /api/portal/orders',
    'GET /api/portal/orders/:id',
    'GET /api/portal/orders/:id/again',
    'POST /api/portal/orders/:id/agree',
    'POST /api/portal/orders/:id/cancel',
    'GET /api/portal/invoices',
    'GET /api/portal/invoices/:id/print',
    'GET /api/portal/account',
    'GET /api/portal/statement',
  ],
  signedIn: [
    'GET /api/me/two-step',
    'POST /api/me/two-step/start',
    'POST /api/me/two-step/confirm',
    'POST /api/me/two-step/backup-codes',
    'POST /api/me/two-step/off',
    'GET /api/me/passkeys',
    'POST /api/me/passkeys/options',
    'POST /api/me/passkeys',
    'PATCH /api/me/passkeys/:id',
    'DELETE /api/me/passkeys/:id',
    'POST /api/auth/logout',
    'GET /api/auth/me',
    'POST /api/auth/switch',
    'POST /api/auth/invites/:token/join',
    'GET /api/categories/',
    'GET /api/products/',
    'GET /api/products/barcode/:barcode',
    'GET /api/products/:id',
    'GET /api/inventory/',
    'GET /api/inventory/:productId',
    'GET /api/pricing/tiers/:productId',
    'GET /api/notifications/',
    'GET /api/notifications/push',
    'PUT /api/notifications/push/preferences',
    'POST /api/notifications/push/devices',
    'POST /api/notifications/push/test',
    'DELETE /api/notifications/push/devices',
    'POST /api/notifications/read-all',
    'PATCH /api/notifications/:id/read',
    'GET /api/favorites/',
    'GET /api/favorites/ids',
    'PUT /api/favorites/:productId',
    'DELETE /api/favorites/:productId',
    'GET /api/payroll/me',
    'GET /api/settings/rules',
    'GET /api/permissions/',
    'POST /api/me/password',
    'POST /api/me/email',
    'PUT /api/me/profile',
    'PUT /api/me/avatar',
    'DELETE /api/me/avatar',
    'GET /api/me/security',
    'DELETE /api/me/google',
    'PUT /api/me/pin',
    'GET /api/me/sessions',
    'POST /api/me/sessions/log-out-others',
    'DELETE /api/me/sessions/:sessionId',
    'GET /api/business/',
  ],
  team: [
    'GET /api/stock-moves/',
    'GET /api/stock-moves/:id',
    'GET /api/locations/',
    'GET /api/locations/products/:productId',
    'GET /api/projects/',
    'GET /api/makes/',
    'GET /api/makes/plan',
    'GET /api/makes/recipes',
    'GET /api/makes/recipes/:productId',
    'GET /api/makes/:id',
    'GET /api/serials/products',
    'GET /api/attention/',
    'GET /api/expiry/',
    'GET /api/expiry/short-dated',
  ],
  counter: [
    'GET /api/sales/checkouts/mine',
    'POST /api/sales/',
    'POST /api/sales/basket',
    'POST /api/sales/:saleId/returns',
    'PUT /api/documents/:id/fiscal-receipt',
    'GET /api/reports/my-sales',
    'GET /api/carwash/places',
    'GET /api/carwash/today',
    'PUT /api/carwash/:day',
    'GET /api/cash-counts/today',
    'POST /api/cash-counts/',
    'POST /api/cash-counts/opening',
    'GET /api/serials/',
    'POST /api/serials/',
    'GET /api/serials/products/:productId',
    'GET /api/day/',
    'POST /api/customers/',
    'POST /api/customers/:id/payments',
    'GET /api/orders/deliveries',
    'POST /api/orders/:id/receive',
    'GET /api/counter/settings',
    'POST /api/counter/events',
    'GET /api/counter/shelf',
    'GET /api/counter/today',
    'GET /api/counter/receipts',
    'GET /api/counter/pin-people',
    'POST /api/counter/switch',
    'POST /api/counter/rabat-approvals',
    'POST /api/counter/pay-later-approvals',
    'POST /api/bill-scans/',
    'POST /api/product-requests/',
    'POST /api/expiry/',
    'POST /api/expiry/:id/clear',
    'POST /api/expiry/:id/write-off',
    'GET /api/settings/',
    'POST /api/write-offs/',
    'GET /api/stock-counts/',
    'POST /api/stock-counts/',
    'GET /api/stock-counts/trefin',
    'GET /api/stock-counts/trefin/:id',
    'GET /api/stock-counts/:id',
    'PUT /api/stock-counts/:id/lines/:productId',
    'POST /api/stock-counts/:id/submit',
    'POST /api/stock-counts/:id/cancel',
    'GET /api/offers/:id',
    'GET /api/partners/lookup',
    'POST /api/partners/read',
    'POST /api/partners/:side/:id/addresses',
    'GET /api/files/offer/:id',
    'POST /api/files/offer/:id',
    'GET /api/deliveries/',
    'GET /api/deliveries/last-address',
    'POST /api/deliveries/:id/take',
    'POST /api/deliveries/:id/delivered',
    'POST /api/deliveries/:id/missed',
    'GET /api/approvals/mine',
  ],
  counterOrAccountant: [
    'GET /api/documents/:id',
    'GET /api/documents/:id/print',
    'GET /api/customers/',
    'GET /api/customers/:id',
    'GET /api/partners/:side/:id/addresses',
    'GET /api/files/customer/:id',
    'POST /api/files/customer/:id',
  ],
  money: [
    'GET /api/sales/',
    'GET /api/sales/checkouts',
    'GET /api/documents/',
    'GET /api/reports/summary',
    'GET /api/reports/profit',
    'GET /api/reports/daily-summary',
    'GET /api/reports/full',
    'GET /api/expenses/',
    'GET /api/expenses/recurring',
    'GET /api/stock-documents/',
    'GET /api/stock-documents/:id',
    'GET /api/projects/profit',
    'GET /api/projects/:id/documents',
    'GET /api/assets/',
    'GET /api/assets/download',
    'GET /api/assets/opening',
    'GET /api/assets/check',
    'GET /api/assets/schedule/:year',
    'GET /api/assets/schedule/:year/download',
    'GET /api/assets/:id',
    'GET /api/suppliers/',
    'GET /api/orders/',
    'GET /api/orders/:id',
    'GET /api/bills/',
    'GET /api/bills/summary',
    'GET /api/bills/repeats',
    'GET /api/bills/:id',
    'GET /api/books/accounts',
    'GET /api/books/accounts/:id/card',
    'GET /api/books/trial-balance',
    'GET /api/books/journal',
    'GET /api/books/entries',
    'GET /api/books/entries/:id',
    'GET /api/books/trefin-entries/:id',
    'GET /api/books/trial-balance.xlsx',
    'GET /api/books/journal.xlsx',
    'GET /api/books/ledger.xlsx',
    'GET /api/books/accounts/:id/card.xlsx',
    'GET /api/books/settings',
    'GET /api/books/opening',
    'GET /api/books/statements/:kind',
    'GET /api/books/statements/:kind/download',
    'GET /api/books/year/:year',
    'POST /api/books/year/:year/close',
    'POST /api/books/year/:year/reopen',
    'POST /api/books/year/:year/instalments',
    'PUT /api/books/year/:year/inputs',
    'DELETE /api/books/instalments/:id',
    'GET /api/books/declaration/:year',
    'GET /api/books/declaration/:year/download',
    'PUT /api/books/declaration/:year/inputs',
    'POST /api/books/declaration/:year/file',
    'POST /api/books/declaration/:year/reopen',
    'POST /api/books/declaration/:year/pay',
    'GET /api/money/places',
    'GET /api/money/places/:id/book',
    'GET /api/money/places/:id/book.xlsx',
    'GET /api/money/places/:id/statements',
    'GET /api/money/places/:id/lines',
    'GET /api/money/rules',
    'GET /api/vat/filed',
    'GET /api/vat/trefin',
    'GET /api/vat/year/:year',
    'GET /api/vat/year/:year/download',
    'GET /api/vat/:month',
    'PUT /api/vat/:month',
    'POST /api/vat/:month/file',
    'POST /api/vat/:month/reopen',
    'GET /api/vat/:month/withholding',
    'GET /api/vat/:month/withholding/download',
    'GET /api/vat/:month/books/:kind',
    'GET /api/vat/:month/trefin',
    'POST /api/vat/:month/trefin/explain',
    'GET /api/threads/:kind/:id',
    'POST /api/threads/:kind/:id',
    'GET /api/exports/sales.csv',
    'GET /api/exports/sales.xlsx',
    'GET /api/exports/stock.csv',
    'GET /api/exports/stock.xlsx',
    'GET /api/exports/money.csv',
    'GET /api/exports/money.xlsx',
    'GET /api/exports/expenses.csv',
    'GET /api/exports/expenses.xlsx',
    'GET /api/exports/stock-documents.csv',
    'GET /api/exports/stock-documents.xlsx',
    'GET /api/exports/stock-moves.csv',
    'GET /api/exports/stock-moves.xlsx',
    'GET /api/exports/projects.csv',
    'GET /api/exports/projects.xlsx',
    'GET /api/exports/team.csv',
    'GET /api/exports/team.xlsx',
    'GET /api/exports/prices.csv',
    'GET /api/exports/prices.xlsx',
    'GET /api/exports/price-list.csv',
    'GET /api/exports/price-list.xlsx',
    'GET /api/offers/',
    'GET /api/offers/history',
    'GET /api/offers/history/:id',
    'GET /api/partners/link',
    'GET /api/partners/customers/:id/bonus',
    'GET /api/files/bill/:id',
    'POST /api/files/bill/:id',
    'GET /api/files/expense/:id',
    'POST /api/files/expense/:id',
    'GET /api/files/document/:id',
    'POST /api/files/document/:id',
    'GET /api/files/order/:id',
    'POST /api/files/order/:id',
    'GET /api/files/supplier/:id',
    'POST /api/files/supplier/:id',
    'GET /api/files/entry/:id',
    'POST /api/files/entry/:id',
  ],
  overseers: [
    'GET /api/products/prices',
    'POST /api/products/prices/plan',
    'POST /api/products/prices/from-cost',
    'POST /api/products/prices/file',
    'POST /api/products/prices',
    'PUT /api/products/:id/barcode',
    'POST /api/products/:id/barcode',
    'POST /api/products/:id/barcodes',
    'DELETE /api/products/:id/barcodes/:barcode',
    'PUT /api/products/:id/image',
    'DELETE /api/products/:id/image',
    'GET /api/products/:id/price-history',
    'POST /api/products/',
    'PUT /api/products/:id',
    'GET /api/duplicates/',
    'POST /api/duplicates/:id/merge',
    'POST /api/duplicates/:id/keep-both',
    'PUT /api/pricing/tiers/:productId',
    'GET /api/promotions/',
    'GET /api/promotions/summary',
    'GET /api/promotions/:id/results',
    'GET /api/analytics/dashboard',
    'GET /api/analytics/revenue',
    'GET /api/analytics/products/:productId',
    'GET /api/users/',
    'GET /api/users/:id/sessions',
    'GET /api/activity/',
    'GET /api/activity/history',
    'POST /api/activity/:id/undo',
    'POST /api/activity/:id/restore',
    'GET /api/reports/team',
    'GET /api/reports/patterns',
    'GET /api/reports/reorder-suggestions',
    'GET /api/reports/insights',
    'GET /api/reports/settings',
    'PUT /api/reports/settings',
    'POST /api/reports/send-test',
    'GET /api/carwash/',
    'GET /api/cash-counts/',
    'POST /api/cash-counts/:id/check',
    'POST /api/stock-moves/',
    'POST /api/stock-moves/:id/void',
    'POST /api/locations/',
    'PATCH /api/locations/:id',
    'DELETE /api/locations/:id',
    'PUT /api/locations/products/:productId',
    'POST /api/projects/',
    'PUT /api/projects/tag',
    'PATCH /api/projects/:id',
    'DELETE /api/projects/:id',
    'POST /api/makes/',
    'PUT /api/makes/recipes/:productId',
    'POST /api/makes/:id/void',
    'PUT /api/serials/products/:productId',
    'DELETE /api/serials/:id',
    'GET /api/orders/usual-suppliers',
    'POST /api/bills/repeats/:id/stop',
    'POST /api/bills/preview',
    'POST /api/bills/',
    'PUT /api/bills/:id',
    'POST /api/bills/:id/payments',
    'POST /api/bills/:id/payments/:paymentId/void',
    'POST /api/bills/:id/void',
    'POST /api/bills/:id/credit',
    'PUT /api/bills/:id/photo',
    'DELETE /api/bills/:id/photo',
    'POST /api/money/places',
    'PATCH /api/money/places/:id',
    'POST /api/money/places/:id/statements',
    'POST /api/money/places/:id/confirm-sure',
    'POST /api/money/lines/:id/confirm',
    'POST /api/money/lines/:id/undo',
    'POST /api/money/lines/:id/skip',
    'POST /api/money/moves',
    'POST /api/money/moves/:id/void',
    'POST /api/money/pay-bills',
    'POST /api/money/rules',
    'PUT /api/money/rules/:id',
    'DELETE /api/money/rules/:id',
    'GET /api/counter/people',
    'GET /api/counter/events',
    'GET /api/bill-scans/',
    'GET /api/bill-scans/:id',
    'GET /api/bill-scans/:id/quick',
    'POST /api/bill-scans/:id/quick-confirm',
    'POST /api/bill-scans/:id/confirm',
    'POST /api/bill-scans/:id/discard',
    'GET /api/bill-emails/',
    'GET /api/bill-emails/settings',
    'PUT /api/bill-emails/settings',
    'POST /api/bill-emails/:id/read',
    'POST /api/bill-emails/:id/remove',
    'GET /api/product-requests/',
    'GET /api/product-requests/:id',
    'POST /api/product-requests/:id/approve',
    'POST /api/product-requests/:id/reject',
    'GET /api/write-offs/',
    'POST /api/write-offs/:id/approve',
    'POST /api/write-offs/:id/reject',
    'GET /api/returns/',
    'POST /api/returns/:id/approve',
    'POST /api/returns/:id/reject',
    'POST /api/stock-counts/:id/lines/:productId/approve',
    'POST /api/stock-counts/:id/lines/:productId/reject',
    'POST /api/stock-counts/:id/approve-all',
    'POST /api/offers/',
    'POST /api/offers/:id/decline',
    'GET /api/approvals/summary',
    'GET /api/assistant/',
    'GET /api/assistant/chats',
    'GET /api/assistant/chats/:id',
    'POST /api/assistant/chats/messages',
    'DELETE /api/assistant/chats/:id',
    'POST /api/assistant/price-suggestions/:productId',
    'GET /api/portal-admin/customers/:id',
    'PUT /api/portal-admin/customers/:id',
    'POST /api/portal-admin/customers/:id/people',
    'POST /api/portal-admin/customers/:id/people/:personId/link',
    'DELETE /api/portal-admin/customers/:id/people/:personId',
    'POST /api/portal-admin/customers/:id/sign-out',
    'GET /api/portal-admin/orders',
    'GET /api/portal-admin/orders/:id',
    'POST /api/portal-admin/orders/:id/accept',
    'PUT /api/portal-admin/orders/:id',
    'POST /api/portal-admin/orders/:id/decline',
  ],
  managers: [
    'POST /api/users/:id/two-step/reset',
    'POST /api/users/:id/passkeys/reset',
    'POST /api/categories/',
    'PUT /api/categories/:id',
    'DELETE /api/categories/:id',
    'DELETE /api/products/:id',
    'PATCH /api/inventory/:productId',
    'POST /api/promotions/preview',
    'POST /api/promotions/',
    'POST /api/promotions/:id/end',
    'PUT /api/users/:id',
    'DELETE /api/users/:id',
    'POST /api/carwash/places',
    'PATCH /api/carwash/places/:id',
    'DELETE /api/carwash/:day',
    'POST /api/expenses/',
    'POST /api/expenses/recurring/:id/stop',
    'DELETE /api/expenses/:id',
    'POST /api/stock-documents/',
    'POST /api/stock-documents/:id/void',
    'PUT /api/day/no-expenses',
    'PUT /api/customers/:id',
    'POST /api/customers/:id/archive',
    'POST /api/suppliers/',
    'PUT /api/suppliers/:id',
    'DELETE /api/suppliers/:id',
    'POST /api/orders/',
    'POST /api/orders/:id/cancel',
    'POST /api/books/accounts',
    'PATCH /api/books/accounts/:id',
    'PUT /api/books/settings',
    'PUT /api/counter/settings',
    'PUT /api/settings/',
    'PUT /api/settings/rules',
    'POST /api/partners/customers/:id/offset',
    'POST /api/partners/customers/:id/bonus/:year/pay',
    'PUT /api/partners/addresses/:id',
    'DELETE /api/partners/addresses/:id',
    'DELETE /api/files/:id',
    'GET /api/bin/',
    'POST /api/bin/:kind/:id/restore',
    'GET /api/invites/',
    'POST /api/invites/',
    'POST /api/invites/:id/resend',
    'DELETE /api/invites/:id',
    'PUT /api/business/',
    'PUT /api/business/logo',
    'DELETE /api/business/logo',
    'PUT /api/business/pictures/:which',
    'DELETE /api/business/pictures/:which',
  ],
  payroll: [
    'GET /api/payroll/months/:id/payslips/:employeeId',
    'GET /api/payroll/employees',
    'GET /api/payroll/team',
    'POST /api/payroll/employees',
    'GET /api/payroll/employees/:id',
    'PUT /api/payroll/employees/:id',
    'POST /api/payroll/employees/:id/leave',
    'DELETE /api/payroll/leave/:id',
    'GET /api/payroll/months',
    'POST /api/payroll/run/:month/preview',
    'POST /api/payroll/run/:month',
    'GET /api/payroll/months/:id',
    'POST /api/payroll/months/:id/undo',
    'POST /api/payroll/months/:id/pay-wages',
    'POST /api/payroll/months/:id/pay-atk',
    'GET /api/payroll/months/:id/declaration',
    'POST /api/payroll/payments/:id/undo',
  ],
  entries: [
    'POST /api/assets/',
    'PATCH /api/assets/:id',
    'DELETE /api/assets/:id',
    'POST /api/assets/:id/split',
    'POST /api/assets/:id/dispose',
    'POST /api/assets/:id/undo-disposal',
    'POST /api/books/entries',
    'POST /api/books/entries/:id/reverse',
    'POST /api/books/opening/lines',
    'PATCH /api/books/opening/lines/:id',
    'DELETE /api/books/opening/lines/:id',
    'POST /api/books/opening/confirm',
    'POST /api/books/opening/post',
    'POST /api/books/opening/take-back',
  ],
  leaders: ['GET /api/support-visits/'],
  developer: [
    'GET /api/activity/:id/restore-point',
    'POST /api/activity/:id/restore-point',
    'POST /api/bill-scans/:id/reopen',
    'GET /api/settings/launch-checklist',
    'POST /api/businesses/',
    'GET /api/all-logs/activity',
    'GET /api/all-logs/support',
    'GET /api/all-logs/businesses',
    'POST /api/settings/test-email',
    'GET /api/settings/wipe-preview',
    'POST /api/settings/wipe',
    'PUT /api/permissions/',
    'GET /api/permissions/history',
    'POST /api/permissions/history/:id/restore',
  ],
};

const ORIGIN = 'http://localhost:5173';
/** Signing out goes last, so it can't end a session the other calls still use. */
const SIGNS_OUT = /sign-out|logout|log-out-others|sessions\/:sessionId/;

/** An id that doesn't exist, or a token-like string for anything else. */
function fillPath(path: string): string {
  return path
    .replace(/[{}]/g, '')
    .replace(/\*\w+/g, 'x')
    .replace(/:(\w+)/g, (_match, name: string) => (/id$/i.test(name) ? '999999' : 'z'.repeat(42)));
}

let context: TestContext;

async function headersFor(caller: Caller): Promise<Record<string, string>> {
  await resetData(context.db);
  await context.db.deleteFrom('portal_users').execute();
  if (caller === 'signedOut') return {};
  if (caller === 'portalCustomer') {
    const admin = { Authorization: `Bearer ${await loginAs(context, 'admin', { email: 'boss@test.local' })}` };
    const api = () => request(context.app);
    const firm = await api().post('/api/customers').set(admin).send({ name: 'Arta', kind: 'business', nui: '811234567', phone: '044 123 456' });
    const id = firm.body.data.id as number;
    await api().put(`/api/portal-admin/customers/${id}`).set(admin).send({ enabled: true, canOrder: true, minOrder: null, categories: null });
    const invite = await api().post(`/api/portal-admin/customers/${id}/people`).set(admin).send({ name: 'Besa' });
    const used = await api().post('/api/portal/links/use').set('Origin', ORIGIN).send({ token: String(invite.body.data.link).split('#')[1] });
    const cookie = ([] as string[]).concat(used.headers['set-cookie'] ?? [])[0];
    if (!cookie) throw new Error('The portal sign-in for the test failed');
    return { Cookie: cookie.split(';')[0]! };
  }
  const user = await createTestUser(context.db, caller);
  const token = signAccessToken(
    { userId: user.id, email: user.email, role: caller, sessionId: '00000000-0000-4000-8000-000000000001' },
    context.config.jwtSecret,
    '1h',
  );
  return { Authorization: `Bearer ${token}` };
}

/**
 * The audit is split over three test files (accessAudit.test.ts, accessAudit2/3.test.ts), one group of callers
 * each, so they run side by side on the test workers. Grouped by how long each caller takes (about 15–21s).
 */
export const CALLER_GROUPS: readonly (readonly Caller[])[] = [
  ['admin', 'signedOut', 'accountant'],
  ['employee', 'portalCustomer', 'family'],
  ['developer', 'owner'],
];

/** Register the audit for one group of callers. The first group's file also checks the route table and the groups. */
export function auditAccess(group: number): void {
  const callers = CALLER_GROUPS[group]!;
  beforeAll(async () => {
    context = await setupTestApp();
  });
  afterAll(() => context.db.destroy());

  describe('access audit: every route × every caller', () => {
    it.runIf(group === 0)('splits every caller into exactly one group', () => {
      expect([...CALLER_GROUPS.flat()].sort()).toEqual([...CALLERS].sort());
    });

    it.runIf(group === 0)('has every route in the table, and nothing in the table that no longer exists', () => {
      const live = new Set(listRoutes(context.app).map((route) => `${route.method} ${route.path}`));
      const listed = Object.values(ACCESS).flat();
      expect(listed.filter((key) => !live.has(key)), 'in the table but not in the app').toEqual([]);
      expect([...live].filter((key) => !listed.includes(key)), 'new routes: add them to ACCESS with who may use them').toEqual([]);
      expect(listed.length, 'a route is listed twice').toBe(new Set(listed).size);
    });

    it.each(callers)('lets %s in exactly where it should', async (caller) => {
      const tierOf = new Map(Object.entries(ACCESS).flatMap(([tier, keys]) => keys.map((key) => [key, tier as keyof typeof WHO] as const)));
      const routes = listRoutes(context.app).sort((a, b) => Number(SIGNS_OUT.test(a.path)) - Number(SIGNS_OUT.test(b.path)));
      const headers = await headersFor(caller);
      const wrong: string[] = [];
      let app = createApp(context.config, context.db, { container: context.container });
      let calls = 0;
      for (const route of routes) {
        const key = `${route.method} ${route.path}`;
        const tier = tierOf.get(key);
        if (!tier) continue;
        // Rate limits are counted per app: a fresh one before any limit could be reached, so they never decide the answer.
        // (Building one takes about 18ms; one per call was half this file's time.)
        if (calls === CALLS_PER_APP) {
          app = createApp(context.config, context.db, { container: context.container });
          calls = 0;
        }
        calls += 1;
        const call = request(app)[route.method.toLowerCase() as 'get'](fillPath(route.path)).set(headers);
        if (route.method !== 'GET') call.set('Origin', ORIGIN);
        const response = route.method === 'GET' ? await call : await call.send({});
        const refused = response.status === 401 || response.status === 403;
        const shouldGetIn = (WHO[tier] as readonly Caller[]).includes(caller);
        if (shouldGetIn === refused) wrong.push(`${key}: ${response.status}, expected ${shouldGetIn ? 'to get in' : 'refused'} (${tier})`);
        else if (response.status >= 500 && response.body?.error !== 'AI_UNAVAILABLE') wrong.push(`${key}: crashed with ${response.status}`);
      }
      expect(wrong).toEqual([]);
    }, 300_000);
  });
}
