// node --test src/  (no Electron needed)
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { STRIP_HEIGHT, pageBounds, stepTarget, menuTemplate, wordsFor } = require('./frame.js');

const isDashboard = (url) => url.startsWith('https://4vd.app/');

test('the dashboard sits under the strip, and fills the window in full screen', () => {
  assert.deepEqual(pageBounds({ width: 1440, height: 900 }, false), { x: 0, y: STRIP_HEIGHT, width: 1440, height: 900 - STRIP_HEIGHT });
  assert.deepEqual(pageBounds({ width: 1920, height: 1080 }, true), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal(pageBounds({ width: 400, height: 10 }, false).height, 0);
});

test('Back and Forward only land on the dashboard, never on the loading or offline page', () => {
  const urls = ['file:///C:/app/loading.html', 'https://4vd.app/', 'https://4vd.app/sales', 'file:///C:/app/offline.html', 'https://4vd.app/counter'];
  assert.equal(stepTarget({ index: 2, urls }, -1, isDashboard), 1);
  assert.equal(stepTarget({ index: 1, urls }, -1, isDashboard), null);
  assert.equal(stepTarget({ index: 4, urls }, -1, isDashboard), null);
  assert.equal(stepTarget({ index: 1, urls }, 1, isDashboard), 2);
  assert.equal(stepTarget({ index: 4, urls }, 1, isDashboard), null);
  assert.equal(stepTarget({ index: 0, urls: [] }, -1, isDashboard), null);
});

test('the menu has File, Edit, View, Go and Help, in both languages', () => {
  const state = { canBack: false, canForward: true, fullScreen: true, signedInPage: true, devTools: false };
  const en = menuTemplate('en', state, () => {});
  assert.deepEqual(en.map((entry) => entry.label), ['File', 'Edit', 'View', 'Go', 'Help']);
  const sq = menuTemplate('sq', state, () => {});
  assert.deepEqual(sq.map((entry) => entry.label), ['Skedari', 'Ndrysho', 'Pamja', 'Shko', 'Ndihmë']);
  assert.equal(menuTemplate('de', state, () => {})[0].label, 'File');
});

test('menu entries run their command, show shortcuts without taking them, and follow the state', () => {
  const ran = [];
  const items = (template) => template.flatMap((entry) => entry.submenu).filter((entry) => entry.label);
  const find = (template, label) => items(template).find((entry) => entry.label === label);
  const signedOut = menuTemplate('en', { canBack: true, canForward: false, fullScreen: false, signedInPage: false, devTools: true }, (command) => ran.push(command));
  for (const entry of items(signedOut)) assert.equal(entry.registerAccelerator, false, entry.label);
  find(signedOut, 'Counter').click();
  find(signedOut, 'Back').click();
  assert.deepEqual(ran, ['go:/counter', 'back']);
  assert.equal(find(signedOut, 'Back').enabled, true);
  assert.equal(find(signedOut, 'Forward').enabled, false);
  // An older saved copy of the dashboard doesn't listen for Log out or Search: they are greyed, not silent.
  assert.equal(find(signedOut, 'Log out').enabled, false);
  assert.equal(find(signedOut, 'Search…').enabled, false);
  assert.equal(find(signedOut, 'Full screen').checked, false);
  assert.ok(find(signedOut, 'Developer tools'));
  const shop = menuTemplate('en', { canBack: false, canForward: false, fullScreen: true, signedInPage: true, devTools: false }, () => {});
  assert.equal(find(shop, 'Developer tools'), undefined);
  assert.equal(find(shop, 'Log out').enabled, true);
});

test('words for the strip keys and the About box', () => {
  assert.equal(wordsFor('sq').back, 'Prapa');
  assert.equal(wordsFor('en').aboutDetail('0.6.0'), 'Version 0.6.0');
});

test('the strip page keeps its keys in the strip, not in the middle of the window behind the page', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, 'strip.css'), 'utf8');
  const rule = css.match(/\.strip \{[^}]*\}/)[0];
  assert.match(rule, new RegExp(`height: ${STRIP_HEIGHT}px;`));
});
