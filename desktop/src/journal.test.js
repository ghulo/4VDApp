// node --test src/  (no Electron needed: journal.js only touches one file)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const journal = require('./journal.js');

const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'journal-')), 'fiscal-journal.json');
const KEY = '0b6f6c2e-6a1d-4c8e-9a43-3d2b7f1e5a10';

test('a receipt is noted when it goes to F-Link and again with F-Link’s answer', () => {
  const file = fresh();
  assert.equal(journal.lookup(file, KEY), null);
  assert.equal(journal.start(file, KEY, '4VD-F-1', 1_000), true);
  assert.deepEqual(journal.lookup(file, KEY), { key: KEY, job: '4VD-F-1', status: 'printing', receiptNo: null, message: null, at: 1_000 });
  assert.equal(journal.finish(file, KEY, { status: 'printed', receiptNo: '00042' }, 2_000), true);
  assert.deepEqual(journal.lookup(file, KEY), { key: KEY, job: '4VD-F-1', status: 'printed', receiptNo: '00042', message: null, at: 2_000 });
});

test('a failed or untaken job keeps why', () => {
  const file = fresh();
  journal.start(file, KEY, 'job', 1_000);
  journal.finish(file, KEY, { status: 'failed', message: 'Paper out' }, 2_000);
  assert.equal(journal.lookup(file, KEY).status, 'failed');
  assert.equal(journal.lookup(file, KEY).message, 'Paper out');
  journal.start(file, 'reprint:12', 'job', 3_000);
  journal.finish(file, 'reprint:12', { status: 'not_running' }, 4_000);
  assert.equal(journal.lookup(file, 'reprint:12').status, 'not_running');
  journal.finish(file, 'reprint:12', { status: 'something else' }, 5_000);
  assert.equal(journal.lookup(file, 'reprint:12').status, 'unknown');
});

test('a job left printing when the app closed becomes unknown at the next start', () => {
  const file = fresh();
  journal.start(file, KEY, 'job', 1_000);
  journal.start(file, 'other', 'job', 1_000);
  journal.finish(file, 'other', { status: 'printed', receiptNo: '7' }, 1_500);
  assert.equal(journal.settleStale(file, 2_000), true);
  assert.equal(journal.lookup(file, KEY).status, 'unknown');
  assert.equal(journal.lookup(file, 'other').status, 'printed');
});

test('keys are checked, old entries go, and a broken file reads as empty', () => {
  const file = fresh();
  assert.equal(journal.start(file, '../../etc', 'job'), false);
  assert.equal(journal.lookup(file, 'a b'), null);
  for (let n = 0; n < journal.MAX_ENTRIES + 3; n += 1) journal.start(file, `k${n}`, 'job', 10_000 + n);
  assert.equal(journal.lookup(file, 'k0'), null);
  assert.notEqual(journal.lookup(file, `k${journal.MAX_ENTRIES + 2}`), null);
  // A month later the old ones go.
  journal.start(file, 'late', 'job', 10_000 + 31 * 24 * 3600_000);
  assert.equal(journal.lookup(file, 'k10'), null);
  fs.writeFileSync(file, '{not json');
  assert.equal(journal.lookup(file, 'late'), null);
  assert.equal(journal.start(file, 'again', 'job'), true);
});

test('says when it could not write', () => {
  const file = path.join(fresh(), 'missing-folder', 'journal.json');
  assert.equal(journal.start(file, KEY, 'job'), false);
});

test('a print that throws is noted as unknown (check the printer), never left printing', async () => {
  const file = fresh();
  await assert.rejects(journal.track(file, KEY, 'job', async () => {
    throw new Error('the day zip could not be read');
  }));
  assert.equal(journal.lookup(file, KEY).status, 'unknown');
  assert.equal(await journal.track(file, 'k2', 'job', async () => ({ status: 'printed', receiptNo: '9' })).then((a) => a.status), 'printed');
  assert.equal(journal.lookup(file, 'k2').receiptNo, '9');
  // Without a key it only prints.
  assert.deepEqual(await journal.track(file, undefined, 'job', async () => ({ status: 'printed', receiptNo: null })), { status: 'printed', receiptNo: null });
});
