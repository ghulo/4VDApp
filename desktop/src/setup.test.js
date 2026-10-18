// node --test src/  (no Electron needed: setup.js only touches one file)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const setup = require('./setup.js');

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'setup-')), 'setup.json');

test('a new install starts on the welcome screen', () => {
  const fresh = setup.read(file);
  assert.deepEqual(fresh, { done: false, role: 'office', language: null });
  assert.equal(setup.startPath(fresh), 'welcome');
});

test('a counter PC opens the Counter, a back office PC the dashboard', () => {
  assert.equal(setup.startPath({ done: true, role: 'counter' }), 'counter');
  assert.equal(setup.startPath({ done: true, role: 'office' }), '');
});

test('only known values are kept, and they survive a restart', () => {
  const next = setup.merge(setup.read(file), { done: true, role: 'counter', language: 'sq', extra: 1, openAtLogin: true });
  assert.deepEqual(next, { done: true, role: 'counter', language: 'sq' });
  assert.equal(setup.merge(next, { role: 'kiosk', language: 'de', done: 'yes' }).role, 'counter');
  assert.ok(setup.write(file, next));
  assert.deepEqual(setup.read(file), next);
});

test('a damaged file falls back to the welcome screen', () => {
  fs.writeFileSync(file, '{oops');
  assert.equal(setup.read(file).done, false);
});
