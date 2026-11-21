// Service worker for 4vd.app:
// - a saved copy of the dashboard on this device (the page, its code, fonts and
//   the barcode scanner), so 4VD opens without internet: the Windows app at
//   the shop starts the Counter from it and sells offline;
// - push alerts from the 4VD server, even when the dashboard is closed.
//
// The build (vite.config.ts, savedCopyPlugin) fills in RELEASE and PRECACHE.
// Never cached: anything from the API (api.4vd.app) or any other site, except
// Google's fonts. The page itself is always asked for first (the newest
// release wins); only without an answer does the saved one open. A release's
// code is saved whole before it takes over, and the release before it stays
// too, so a page left open never asks for a file that is gone.

const RELEASE = '__4VD_RELEASE__';
const PRECACHE = /* __4VD_PRECACHE__ */ [];
// In development (vite dev) nothing is filled in: no saved copy, alerts only.
const SAVES = !RELEASE.startsWith('__');
const SHELL_PREFIX = '4vd-shell-';
const SHELL = SHELL_PREFIX + RELEASE;
const FONTS = '4vd-fonts';
const META = '4vd-meta';
/** How long the page waits for the internet before it opens the saved copy (Wi-Fi up, internet down can hang). */
const PAGE_TIMEOUT_MS = 5000;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  if (!SAVES) {
    self.skipWaiting();
    return;
  }
  // All or nothing: if one file can't be saved, this release doesn't take over and the last one stays.
  event.waitUntil(saveRelease().then(() => self.skipWaiting()));
});

/**
 * Save this release's files. Code files keep their content's hash in their name, so one the last release saved already
 * is copied over instead of downloaded again; the page and the files without a hash in their name are always fetched fresh.
 */
async function saveRelease() {
  const cache = await caches.open(SHELL);
  const fetchFresh = [];
  const copies = [];
  for (const url of PRECACHE) {
    const saved = url.startsWith('/assets/') ? await caches.match(url, { ignoreVary: true }) : undefined;
    if (saved) copies.push(cache.put(url, saved));
    else fetchFresh.push(new Request(url, { cache: 'reload' }));
  }
  await Promise.all(copies);
  await cache.addAll(fetchFresh);
  // The page fetched just now must be this release's: during a deploy it can already be the next one, whose code this
  // worker never saved (an offline start would then find nothing to run). Then this release doesn't take over.
  const page = await cache.match('/', { ignoreVary: true });
  const html = page ? await page.text() : '';
  const saved = new Set(PRECACHE);
  for (const [, url] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) {
    if (!saved.has(url)) {
      await caches.delete(SHELL);
      throw new Error(`The page names ${url}, which this release doesn't have`);
    }
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (SAVES) {
        // This release and the one before it stay; older saved copies go.
        const meta = await caches.open(META);
        const known = await meta.match('/releases').then((response) => (response ? response.json() : {})).catch(() => ({}));
        const previous = known.current && known.current !== SHELL ? known.current : known.previous;
        await meta.put('/releases', new Response(JSON.stringify({ current: SHELL, previous: previous ?? null })));
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith(SHELL_PREFIX) && name !== SHELL && name !== previous).map((name) => caches.delete(name)));
      }
      await self.clients.claim();
    })(),
  );
});

/** The saved copy of the page, as a fresh answer (a saved one may have been redirected, which a page load refuses). */
async function savedPage() {
  const saved = (await caches.match('/', { cacheName: SHELL, ignoreVary: true })) ?? (await caches.match('/', { ignoreVary: true }));
  if (!saved) return null;
  return new Response(await saved.blob(), { status: 200, headers: saved.headers });
}

/** The page: from the internet if it answers in time, else the saved copy, else the browser's own "no internet". */
async function page(request) {
  const network = fetch(request);
  // An answer that comes too late (or never) is let go quietly.
  network.catch(() => undefined);
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS, 'timeout'));
  try {
    const answer = await Promise.race([network, timeout]);
    if (answer !== 'timeout') return answer;
  } catch {
    // No internet: the saved copy below.
  }
  const saved = await savedPage();
  return saved ?? network;
}

/**
 * A file of the dashboard (code, fonts, the scanner): the saved one, else the internet.
 * Vary is ignored: files are saved without the Origin header the page's module scripts send.
 */
async function file(request) {
  // This release's own first: boot.js, the icons and the scanner have the same names in every release.
  const saved =
    (await caches.match(request, { cacheName: SHELL, ignoreSearch: true, ignoreVary: true })) ??
    (await caches.match(request, { ignoreSearch: true, ignoreVary: true }));
  return saved ?? fetch(request);
}

/** Google's fonts: the saved ones at once, refreshed in the background. */
async function font(request) {
  const cache = await caches.open(FONTS);
  const saved = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok || response.type === 'opaque') void cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return saved ?? (await fresh) ?? Response.error();
}

const SAVED_PATHS = new Set(PRECACHE);

self.addEventListener('fetch', (event) => {
  if (!SAVES || event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) {
    if (event.request.mode === 'navigate') return event.respondWith(page(event.request));
    if (SAVED_PATHS.has(url.pathname) || url.pathname.startsWith('/assets/')) return event.respondWith(file(event.request));
    return;
  }
  if (FONT_HOSTS.includes(url.hostname)) event.respondWith(font(event.request));
  // Anything else (the API, Google sign-in, Sentry…) goes straight to the internet, never saved.
});

const PAGE_BY_TYPE = {
  low_stock: '/inventory?lowStock=true',
  out_of_stock: '/inventory?lowStock=true',
  approval: '/inbox',
  cash_difference: '/cash',
  daily_summary: '/report',
};

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(payload.title || '4VD', {
      body: payload.body || '',
      icon: '/favicon.svg',
      // Same notification id replaces rather than stacks.
      tag: payload.data ? `4vd-${payload.data.notificationId}` : undefined,
      data: payload.data || {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = data.link || PAGE_BY_TYPE[data.type] || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) return open.focus().then(() => open.navigate(path));
      return self.clients.openWindow(path);
    }),
  );
});
