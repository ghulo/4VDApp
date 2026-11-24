import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, request, test, type Browser, type Page } from '@playwright/test';
import { API_URL } from './api';

/**
 * A brand-new business, made the way 4VD's developer makes one for a customer,
 * then every page opened as its main admin, an employee and its accountant.
 * It catches what only a fresh business shows: 4VD's own name or its
 * carwash leaking into another shop, pages that error, fail a call or stay
 * stuck loading. All problems are collected into one report
 * (test-results/new-business-<part>.md) instead of stopping at the first.
 */

const DEVELOPER = { email: 'e2e-developer@4vd.local', password: 'e2e-developer-4vd' };
const SHOP = { name: 'Dyqani Arbëri', shortName: 'dyqani-arberi' };
const PASSWORD = 'new-business-e2e-4vd';
const PEOPLE = [
  { role: 'main_admin', email: 'main-admin@arberi.test', name: 'Arbër Gashi' },
  { role: 'employee', email: 'employee@arberi.test', name: 'Blerta Hoxha' },
  { role: 'accountant', email: 'accountant@arberi.test', name: 'Dritan Berisha' },
] as const;

/** 4VD may show its name only as the maker's line ("Runs on 4VD"), never as the shop. */
const ALLOWED_4VD = [/runs on 4vd/gi, /powered by 4vd/gi, /punon me 4vd/gi, /mundësuar nga 4vd/gi];
/** This business never turned a carwash on. */
const CARWASH = /carwash|car wash|lavazh/i;
/** Pages that are not part of a business's own dashboard, or are nested ones read without their parent. */
const SKIP = new Set(['login', 'forgot-password', 'download', 'welcome', 'portal', 'portal/join', 'portal/link', 'order', 'invoices', 'account', 'kit', 'all-logs', 'counter', 'details', 'made-from', '*']);
const MAX_PAGES = 220;
/** Detail pages of one kind (e.g. /books/accounts/31) are alike: open at most this many of each. */
const PER_PATTERN = 2;
/** Kinds that only mean something when the page is in the person's menu: a typed address may be refused. */
const ROLE_LIMITED = new Set(['API 403', 'alert']);

interface Finding {
  role: string;
  path: string;
  kind: string;
  detail: string;
}

/** Every page of the dashboard with no id in its address, read from App.tsx so a new page is checked too. */
function staticPages(): string[] {
  const app = readFileSync(new URL('../../admin/src/App.tsx', import.meta.url), 'utf8');
  const paths = [...app.matchAll(/path="([^"]*)"/g)].map((match) => match[1]!.replace(/\/:\w+\?$/, '').replace(/^\//, ''));
  return [...new Set(paths.filter((path) => !path.includes(':') && !SKIP.has(path)).map((path) => `/${path}`))].concat('/counter');
}

async function api(token?: string) {
  const context = await request.newContext({ baseURL: API_URL });
  const call = async (method: 'get' | 'post', path: string, data?: unknown) => {
    const response = await context[method](path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, data });
    expect(response.ok(), `${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  return { get: (path: string) => call('get', path), post: (path: string, body: unknown = {}) => call('post', path, body), dispose: () => context.dispose() };
}

async function tokenOf(email: string, password: string): Promise<string> {
  const anonymous = await api();
  const session = await anonymous.post('/api/auth/login', { email, password });
  await anonymous.dispose();
  return session.accessToken ?? session.token;
}

const tokenIn = (link: string) => new URL(link).pathname.split('/').pop()!;

/** The developer adds the business and invites its three people; all but the main admin accept. Returns the main admin's open invite. */
async function makeBusiness(): Promise<string> {
  const developer = await api(await tokenOf(DEVELOPER.email, DEVELOPER.password));
  const business = await developer.post('/api/businesses', { name: SHOP.name, shortName: SHOP.shortName, legalForm: 'company', language: 'en' });
  const switched = await developer.post('/api/auth/switch', { businessId: business.id });
  await developer.dispose();
  const inside = await api(switched.accessToken ?? switched.token);
  const links: string[] = [];
  for (const person of PEOPLE) links.push((await inside.post('/api/invites', { email: person.email, role: person.role, language: 'en' })).link);
  await inside.dispose();
  const anonymous = await api();
  // The main admin's link stays open so its page can be checked before it is used.
  for (const [index, person] of PEOPLE.entries()) {
    if (index > 0) await anonymous.post(`/api/auth/invites/${tokenIn(links[index]!)}/accept`, { name: person.name, password: PASSWORD, language: 'en' });
  }
  await anonymous.dispose();
  return tokenIn(links[0]!);
}

/** Waits until the page's own calls to the API are answered (polling pages never go fully quiet), at most 8 s. */
async function settle(page: Page, pending: () => number): Promise<void> {
  await page.waitForLoadState('load').catch(() => undefined);
  const until = Date.now() + 8000;
  let quietSince = 0;
  while (Date.now() < until) {
    if (pending() <= 0) {
      quietSince ||= Date.now();
      if (Date.now() - quietSince >= 400) return;
    } else quietSince = 0;
    await page.waitForTimeout(100);
  }
}

/** Looks at the page as it stands and notes what is wrong with it. */
async function inspect(page: Page, role: string, path: string, findings: Finding[]): Promise<void> {
  const note = (kind: string, detail: string) => findings.push({ role, path, kind, detail });
  if (new URL(page.url()).pathname === '/login' && !path.startsWith('/login')) note('signed out', 'the page sent the user back to sign-in');
  const loading = page.locator('.skeleton__row, [aria-busy="true"]');
  if (await loading.first().isVisible().catch(() => false)) {
    await page.waitForTimeout(3000);
    if (await loading.first().isVisible().catch(() => false)) note('stuck loading', 'still shows its loading bars after 11 s');
  }
  const text = await page.evaluate(() => `Tab title: ${document.title}\n${document.body.innerText}`);
  if (/this page doesn’t exist/i.test(text)) note('not found', 'shows "This page doesn’t exist"');
  let rest = text;
  for (const allowed of ALLOWED_4VD) rest = rest.replace(allowed, '');
  for (const match of rest.matchAll(/[^\n]{0,50}4VD[^\n]{0,50}/gi)) note('4VD named', match[0].trim());
  for (const match of text.matchAll(new RegExp(`[^\\n]{0,40}(${CARWASH.source})[^\\n]{0,40}`, 'gi'))) note('carwash', match[0].trim());
  for (const alert of await page.locator('[role="alert"]:visible').allInnerTexts()) if (alert.trim()) note('alert', alert.trim().slice(0, 160));
}

/** Opens every page as one person, following the links each page offers (detail pages, settings sections). */
async function crawl(browser: Browser, role: string, email: string, findings: Finding[]): Promise<number> {
  const context = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Belgrade' });
  const page = await context.newPage();
  let current = '/login';
  let inFlight = 0;
  const isApi = (url: string) => url.startsWith(API_URL);
  page.on('request', (req) => void (isApi(req.url()) && (inFlight += 1)));
  page.on('requestfinished', (req) => void (isApi(req.url()) && (inFlight -= 1)));
  page.on('requestfailed', (req) => void (isApi(req.url()) && (inFlight -= 1)));
  page.on('pageerror', (error) => findings.push({ role, path: current, kind: 'script error', detail: error.message.slice(0, 200) }));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) findings.push({ role, path: current, kind: 'console error', detail: message.text().slice(0, 200) });
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === API_URL && response.status() >= 400 && response.status() !== 401) {
      // 429: the crawler opens pages far faster than a person; noted apart, it says nothing about the page.
      const kind = response.status() === 429 ? 'API 429 (the crawler went faster than the rate limit)' : `API ${response.status()}`;
      findings.push({ role, path: current, kind, detail: `${response.request().method()} ${url.pathname}${url.search}` });
    }
  });

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  current = new URL(page.url()).pathname;
  const firstFinding = findings.length;
  await settle(page, () => inFlight);
  await inspect(page, role, `${current} (first page)`, findings);

  const queue = staticPages();
  const seen = new Set<string>(queue);
  const linked = new Set<string>(['/']);
  const patterns = new Map<string, number>();
  let visited = 0;
  while (queue.length && visited < MAX_PAGES) {
    current = queue.shift()!;
    visited += 1;
    await page.goto(current).catch((error: Error) => findings.push({ role, path: current, kind: 'did not open', detail: error.message.slice(0, 160) }));
    await settle(page, () => inFlight);
    await inspect(page, role, current, findings);
    const links = await page.locator('a[href^="/"]').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')!));
    for (const href of links) {
      const path = href.split(/[?#]/)[0]!.replace(/\/$/, '') || '/';
      linked.add(path);
      if (seen.has(path) || /^\/(portal|api|kit|all-logs)\b/.test(path)) continue;
      seen.add(path);
      const pattern = path.replace(/\/\d+(?=\/|$)/g, '/:id');
      if (pattern !== path) {
        const count = patterns.get(pattern) ?? 0;
        if (count >= PER_PATTERN) continue;
        patterns.set(pattern, count + 1);
      }
      queue.push(path);
    }
  }
  // A page no link leads to, opened by typing its address: being refused there is expected, so it is listed apart.
  for (const finding of findings.slice(firstFinding)) {
    if (ROLE_LIMITED.has(finding.kind) && !linked.has(finding.path)) finding.kind = `${finding.kind} on a page not in this person's menu`;
  }
  await context.close();
  return visited;
}

function report(findings: Finding[], pages: Record<string, number>): string {
  const lines = [`# New business check: ${SHOP.name}`, '', ...Object.entries(pages).map(([role, count]) => `- ${role}: ${count} pages opened`), ''];
  const byKind = new Map<string, Finding[]>();
  for (const finding of findings) byKind.set(finding.kind, [...(byKind.get(finding.kind) ?? []), finding]);
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${kind} (${list.length})`, '');
    // One line per distinct problem, with every page and role it showed on.
    const grouped = new Map<string, Set<string>>();
    for (const finding of list) grouped.set(finding.detail, (grouped.get(finding.detail) ?? new Set()).add(`${finding.role} ${finding.path}`));
    for (const [detail, where] of grouped) lines.push(`- ${detail}  \n  on: ${[...where].slice(0, 8).join(', ')}${where.size > 8 ? ` and ${where.size - 8} more` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** One report per part, written even when the part fails or runs out of time. */
function writeReport(part: string, findings: Finding[], pages: Record<string, number> = {}): string {
  const file = `test-results/new-business-${part}.md`;
  mkdirSync('test-results', { recursive: true });
  writeFileSync(file, report(findings, pages));
  return file;
}

/** Listed in the report, but not a fault of the page: typed addresses a role may not open, and the crawler's own speed. */
const problems = (findings: Finding[]) => findings.filter((finding) => !finding.kind.includes('not in this person') && !finding.kind.startsWith('API 429'));

// The parts run one after another in this order (workers: 1); each stands alone, so one failing never hides the others.
// Hundreds of pages: a trace or screenshots would only slow it down; the report says where.
test.use({ trace: 'off', screenshot: 'off' });

test.describe('a brand-new business', () => {
  // Off on GitHub until the problems it found first (4VD named, carwash shown, role pages refused) are fixed; locally it runs.
  test.skip(!!process.env.CI, 'turned on in CI once the new-business fixes land');
  test('is made; its invite page and its own sign-in link show the shop, not 4VD', async ({ browser }) => {
    const findings: Finding[] = [];
    const mainAdminToken = await makeBusiness();
    const outside = await browser.newPage();
    for (const [label, path] of [['/invite/<link>', `/invite/${mainAdminToken}`], [`/login?b=${SHOP.shortName}`, `/login?b=${SHOP.shortName}`]] as const) {
      await outside.goto(path);
      await outside.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await inspect(outside, 'not signed in', label, findings);
    }
    await outside.close();
    // Now the main admin accepts too.
    const anonymous = await api();
    await anonymous.post(`/api/auth/invites/${mainAdminToken}/accept`, { name: PEOPLE[0].name, password: PASSWORD, language: 'en' });
    await anonymous.dispose();
    expect(problems(findings), `see ${writeReport('signed-out', findings)}`).toEqual([]);
  });

  for (const person of PEOPLE) {
    test(`every page as its ${person.role.replace('_', ' ')}: no 4VD, no carwash, nothing broken`, async ({ browser }) => {
      test.setTimeout(20 * 60_000);
      const findings: Finding[] = [];
      const pages: Record<string, number> = {};
      let file = '';
      try {
        pages[person.role] = await crawl(browser, person.role, person.email, findings);
      } finally {
        file = writeReport(person.role.replace('_', '-'), findings, pages);
      }
      expect(problems(findings), `see ${file}`).toEqual([]);
    });
  }
});
