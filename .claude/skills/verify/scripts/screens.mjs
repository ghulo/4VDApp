// Loads dashboard screens in a headless browser, signed in as demo logins,
// and reports in text what went wrong: console errors, page crashes, failed
// API calls, error notices, a bounce to sign-in, no heading. No screenshots.
//
//   node .claude/skills/verify/scripts/screens.mjs --db real              (screens picked from the diff)
//   node .claude/skills/verify/scripts/screens.mjs --db demo --paths /books,/books/vat [--role accountant]
//   node .claude/skills/verify/scripts/screens.mjs --db real --base origin/main
//
// --db is required and is checked against what port 3000 really serves.
// On the real database (four_vd_app) every API call that isn't a GET or a
// sign-in is answered inside the browser with "blocked" and reported, so
// nothing can be saved there, whatever a screen does on load.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEMO_USERS, ROOT, WEB, probe, requireE2e } from './lib.mjs';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const db = arg('--db');
if (db !== 'real' && db !== 'demo') {
  console.log('screens: FAIL pass --db real or --db demo');
  process.exit(2);
}
const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

// 1. The API must be up and on the database we were told; the dashboard up.
const state = await probe();
if (state !== db) {
  const label = { demo: 'four_vd_app_demo', real: 'four_vd_app', down: 'nothing (API down)', unknown: 'unknown (demo login or list failed)', limited: 'unknown (API rate limit hit; wait 15 min or restart the API)' };
  console.log(`screens: FAIL port 3000 serves ${label[state]}, but --db ${db} was asked. Nothing was loaded.`);
  process.exit(1);
}
try {
  await fetch(WEB, { signal: AbortSignal.timeout(5000) });
} catch {
  console.log('screens: FAIL dashboard not answering on 5173 (preview_start dashboard)');
  process.exit(1);
}

// 2. Which screens, grouped by the role that signs in to see them.
const map = JSON.parse(readFileSync(path.join(ROOT, '.claude/skills/verify/screens.json'), 'utf8'));
const groups = new Map(); // role -> Set(paths)
const add = (role, p) => (groups.get(role) ?? groups.set(role, new Set()).get(role)).add(p);
const forcedRole = arg('--role');
if (arg('--paths')) {
  for (const raw of arg('--paths').split(',')) {
    // Git Bash turns "/x" into "C:/Program Files/Git/x": undo that.
    const p = raw.trim().replace(/^[A-Za-z]:\/Program Files\/Git/, '') || '/';
    add(forcedRole ?? 'admin', p);
  }
} else {
  const base = arg('--base') ?? 'main';
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const files = new Set([
    ...git('diff', '--name-only', `${base}...HEAD`),
    ...git('diff', '--name-only', 'HEAD'),
    ...git('ls-files', '--others', '--exclude-standard'),
  ]);
  map.always.forEach((p) => add(forcedRole ?? 'admin', p));
  for (const file of files) {
    for (const line of map.map) {
      if (new RegExp(line.match, 'i').test(file)) line.paths.forEach((p) => add(forcedRole ?? line.role ?? 'admin', p));
    }
  }
}
for (const role of groups.keys()) {
  if (!DEMO_USERS[role]) {
    console.log(`screens: FAIL unknown role ${role} (${Object.keys(DEMO_USERS).join(', ')})`);
    process.exit(2);
  }
}

// 3. One browser; one fresh context per role.
const { chromium } = requireE2e('@playwright/test');
// The full Chromium in new-headless mode opens a page in ~1s here; the default
// headless shell takes ~13s on this Windows PC. Fall back if it isn't installed.
const browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
const isAuth = (url) => /\/api\/auth\/(login|refresh|logout|two-step|passkeys?\/)/.test(url);
const BLOCK_BODY = '{"error":{"message":"blocked by verify (real database)"}}';
const lines = [];
const blocked = [];
let failures = 0;
let screens = 0;
let apiCalls = 0;
let limited = false;

for (const [role, pathSet] of groups) {
  const user = DEMO_USERS[role];
  // Service workers off: a request a worker handles could slip past context.route and the write block.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const blockedUrls = new Set();
  if (db === 'real') {
    await context.route('**/api/**', (route) => {
      const req = route.request();
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || isAuth(req.url())) return route.continue();
      blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
      blockedUrls.add(req.url());
      return route.fulfill({ status: 409, contentType: 'application/json', body: BLOCK_BODY });
    });
  }
  const page = await context.newPage();
  let events = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (db === 'real' && /status of 409/.test(text)) return; // our own block, reported separately
    events.push(`console: ${text.slice(0, 200)}`);
  });
  page.on('pageerror', (err) => events.push(`crash: ${String(err.message).slice(0, 200)}`));
  page.on('request', (req) => {
    if (req.url().includes(':3000/api/')) apiCalls++;
  });
  page.on('response', (res) => {
    if (res.status() === 429) limited = true;
    if (res.status() < 400 || blockedUrls.has(res.url())) return;
    events.push(`HTTP ${res.status()} ${res.request().method()} ${new URL(res.url()).pathname}`);
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? '';
    if (failure.includes('ERR_ABORTED')) return; // a navigation cancelled it
    events.push(`failed: ${req.method()} ${new URL(req.url()).pathname} ${failure}`);
  });

  // Sign in through the real form.
  try {
    await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[autocomplete="current-password"]').fill(user.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
    lines.push(`ok    sign-in as ${user.email} (at ${since()})${events.length ? `  ${events.join('; ')}` : ''}`);
    if (db === 'real') {
      // Prove the block on every run: a write from the page must come back blocked.
      // The body is empty on purpose, so even an unblocked request would fail validation and save nothing.
      const answer = await page.evaluate(async () => {
        const res = await fetch(`${location.protocol}//${location.hostname}:3000/api/categories`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        return res.text();
      });
      blocked.pop();
      if (!answer.includes('blocked by verify')) {
        console.log(`screens: FAIL the write block did not work on four_vd_app (answer: ${answer.slice(0, 120)}). Stopped before loading any screen.`);
        await browser.close();
        process.exit(1);
      }
      lines.push('ok    write block proven (a test POST from the page came back blocked)');
    }
  } catch (error) {
    // Every screen this role would have opened counts as failed.
    failures += pathSet.size;
    screens += pathSet.size;
    lines.push(`FAIL  sign-in as ${user.email}: ${String(error.message).split('\n')[0]}${events.length ? `  ${events.join('; ')}` : ''}`);
    lines.push(`      skipped as ${role}: ${[...pathSet].join(', ')}`);
    await context.close();
    continue;
  }

  for (const p of pathSet) {
    screens++;
    events = [];
    const before = blocked.length;
    const t0 = Date.now();
    let note = '';
    try {
      await page.goto(`${WEB}${p}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
        note = ' (still busy after 15s)';
      });
      const where = new URL(page.url()).pathname;
      if (where.startsWith('/login')) events.push('sent back to sign-in');
      const notices = await page.locator('.notice--error[role="alert"]').allInnerTexts();
      notices.forEach((n) => events.push(`error notice: ${n.replace(/\s+/g, ' ').slice(0, 160)}`));
      const h1 = (await page.locator('h1').first().innerText({ timeout: 2000 }).catch(() => '')).replace(/\s+/g, ' ').trim();
      if (!h1 && !where.startsWith('/counter')) events.push('no page heading (h1) rendered');
      const writes = blocked.slice(before);
      const status = events.length ? 'FAIL ' : writes.length ? 'WARN ' : 'ok   ';
      if (events.length) failures++;
      let line = `${status} ${p}  "${h1.slice(0, 40)}"  ${((Date.now() - t0) / 1000).toFixed(1)}s${note}`;
      if (where !== p && !where.startsWith('/login')) line += `  -> ${where}`;
      if (role !== 'admin') line += `  [${role}]`;
      if (events.length) line += `\n        ${events.join('\n        ')}`;
      if (writes.length) line += `\n        blocked writes on load: ${writes.join(', ')}`;
      lines.push(line);
    } catch (error) {
      failures++;
      lines.push(`FAIL  ${p}  ${String(error.message).split('\n')[0]}${events.length ? `\n        ${events.join('\n        ')}` : ''}`);
    }
  }

  // Sign out, so the session ends on the server too.
  await page
    .evaluate(() => fetch(`${location.protocol}//${location.hostname}:3000/api/auth/logout`, { method: 'POST', credentials: 'include' }))
    .catch(() => {});
  await context.close();
}

await browser.close();
const dbName = db === 'real' ? 'four_vd_app (writes blocked)' : 'four_vd_app_demo';
console.log(lines.join('\n'));
console.log(
  `screens: ${failures ? 'FAIL' : 'ok'} ${screens - failures}/${screens} screens, roles ${[...groups.keys()].join('+')}, ${dbName}, ${blocked.length} blocked writes, ${apiCalls} API calls, ${since()}`,
);
if (limited) console.log('screens: the API rate limit was hit (1000 requests per login per 15 minutes). Wait 15 minutes, or restart the API you are on; this is not a bug in the change.');
process.exit(failures ? 1 : 0);
