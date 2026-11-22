// node --test src/  (no Electron needed: journal.js only touches one file)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { openJournal, MAX_ENTRIES } = require('./journal.js');
const fiscal = require('./fiscal.js');

const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'journal-')), 'fiscal-journal.json');
const KEY = '0b6f6c2e-6a1d-4c8e-9a43-3d2b7f1e5a10';
const printed = (receiptNo) => async () => ({ status: 'printed', receiptNo });

/** A disk that refuses writes (or reads) while `locked` says so: an antivirus holding the file, a full disk. */
function lockableFs() {
  const state = { writes: true, reads: true };
  const wrapped = {
    ...fs,
    readFileSync: (...args) => {
      if (!state.reads) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return fs.readFileSync(...args);
    },
    writeFileSync: (...args) => {
      if (!state.writes) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      return fs.writeFileSync(...args);
    },
  };
  return { fs: wrapped, state };
}

test('a receipt is noted when it goes and with F-Link’s answer, and survives a restart', async () => {
  const file = fresh();
  let clock = 1_000;
  const journal = openJournal(file, { now: () => clock });
  assert.equal(journal.lookup(KEY), null);
  let during;
  const answer = await journal.track(KEY, '4VD-F-1', async (onFile) => {
    onFile('4VD-F-1-2');
    during = journal.lookup(KEY);
    clock = 2_000;
    return { status: 'printed', receiptNo: '00042' };
  });
  assert.deepEqual(answer, { status: 'printed', receiptNo: '00042' });
  assert.equal(during.status, 'printing');
  assert.deepEqual(journal.lookup(KEY), { key: KEY, job: '4VD-F-1', status: 'printed', receiptNo: '00042', message: null, at: 2_000 });
  assert.equal(openJournal(file).lookup(KEY).receiptNo, '00042');
});

test('a key that printed is never printed again: its answer comes back', async () => {
  const journal = openJournal(fresh());
  await journal.track(KEY, 'job', printed('7'));
  let sent = 0;
  const again = await journal.track(KEY, 'job', async () => {
    sent += 1;
    return { status: 'printed', receiptNo: '8' };
  });
  assert.equal(sent, 0);
  assert.deepEqual(again, { status: 'printed', receiptNo: '7' });
  // A failed one may be printed again.
  await journal.track('k2', 'job', async () => ({ status: 'failed', message: 'Paper out' }));
  assert.equal((await journal.track('k2', 'job', printed('9'))).receiptNo, '9');
});

test('a second print of a key still printing waits for the first instead of sending another', async () => {
  const journal = openJournal(fresh());
  let release;
  let sent = 0;
  const run = () => {
    sent += 1;
    return new Promise((resolve) => (release = () => resolve({ status: 'printed', receiptNo: '5' })));
  };
  const first = journal.track(KEY, 'job', run);
  await new Promise((resolve) => setImmediate(resolve));
  const second = journal.track(KEY, 'job', run);
  release();
  assert.deepEqual(await first, await second);
  assert.equal(sent, 1);
});

test('when the disk refuses the finish, lookups answer from memory and the disk is written once it can', async () => {
  const file = fresh();
  const { fs: lockable, state } = lockableFs();
  const journal = openJournal(file, { fs: lockable, retryMs: 10 });
  await journal.track(KEY, 'job', async () => {
    state.writes = false;
    return { status: 'printed', receiptNo: '11' };
  });
  // The page reloads: it asks, and gets the number although the disk still says printing.
  assert.equal(journal.lookup(KEY).status, 'printed');
  assert.equal(journal.lookup(KEY).receiptNo, '11');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].status, 'printing');
  state.writes = true;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].status, 'printed');
});

test('nothing prints when the journal can’t note that it is going', async () => {
  const { fs: lockable, state } = lockableFs();
  const journal = openJournal(fresh(), { fs: lockable, retryMs: 10 });
  state.writes = false;
  let sent = 0;
  const answer = await journal.track(KEY, 'job', async () => {
    sent += 1;
    return { status: 'printed', receiptNo: '1' };
  });
  assert.deepEqual(answer, { status: 'not_saved', message: null });
  assert.equal(sent, 0);
  assert.equal(journal.lookup(KEY), null);
});

test('a job "printing" that this app no longer has reads as unknown, never as still printing', async () => {
  const file = fresh();
  fs.writeFileSync(file, JSON.stringify([{ key: KEY, job: 'job', status: 'printing', at: 1 }]));
  assert.equal(openJournal(file).lookup(KEY).status, 'unknown');
});

test('after a restart, a cut-off job’s outcome comes from F-Link’s folder when it can say', () => {
  const file = fresh();
  fs.writeFileSync(
    file,
    JSON.stringify([
      { key: 'a', job: 'job', status: 'printing', file: 'J-A', at: Date.now() },
      { key: 'b', job: 'job', status: 'printing', file: 'J-B', at: Date.now() },
      { key: 'c', job: 'job', status: 'printing', file: null, at: Date.now() },
    ]),
  );
  const answers = { 'J-A': { status: 'printed', receiptNo: '77' }, 'J-B': null };
  const journal = openJournal(file, { recover: (entry) => answers[entry.file] });
  assert.equal(journal.settleStale(), true);
  assert.deepEqual([journal.lookup('a').status, journal.lookup('a').receiptNo], ['printed', '77']);
  assert.equal(journal.lookup('b').status, 'unknown');
  // Its file name was noted as none: it never reached F-Link.
  assert.equal(journal.lookup('c').status, 'failed');
});

test('F-Link’s folder: a printed job gives its number, a refused one fails, one never taken is taken back', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'flink-'));
  fs.writeFileSync(path.join(folder, 'J-1.in$'), 'S,1,001756,3,Ok;\r\nJ,1,001757,3,Ok;LastReceiptNumber;00099;123\r\n');
  assert.deepEqual(fiscal.answerFor('J-1', Date.now(), folder), { status: 'printed', receiptNo: '00099' });
  fs.mkdirSync(path.join(folder, 'PrintErrors'));
  fs.writeFileSync(path.join(folder, 'PrintErrors', 'J-2.inp'), 'x');
  assert.equal(fiscal.answerFor('J-2', Date.now(), folder).status, 'failed');
  fs.writeFileSync(path.join(folder, 'J-3.inp'), 'x');
  assert.deepEqual(fiscal.answerFor('J-3', Date.now(), folder), { status: 'not_running' });
  assert.equal(fs.existsSync(path.join(folder, 'J-3.inp')), false);
  assert.equal(fiscal.answerFor('J-4', Date.now(), folder), null);
  // Still in the folder and it can't be taken back (F-Link has it open; here a folder, which unlink refuses): it may print yet.
  fs.mkdirSync(path.join(folder, 'J-5.inp'));
  assert.deepEqual(fiscal.answerFor('J-5', Date.now(), folder), { status: 'still_queued', message: null });
  assert.equal(fs.existsSync(path.join(folder, 'J-5.inp')), true);
});

test('a job F-Link still has and that can’t be taken back is never sent again, not even after an owner’s look', async () => {
  const file = fresh();
  fs.writeFileSync(file, JSON.stringify([{ key: KEY, job: 'job', status: 'unknown', file: 'J-9', at: Date.now() }]));
  let sent = 0;
  const run = async () => {
    sent += 1;
    return { status: 'printed', receiptNo: '12' };
  };
  const journal = openJournal(file, { recover: () => ({ status: 'still_queued', message: null }) });
  assert.deepEqual(await journal.track(KEY, 'job', run), { status: 'still_queued', message: null });
  assert.deepEqual(await journal.track(KEY, 'job', run, { confirmed: true }), { status: 'still_queued', message: null });
  assert.equal(sent, 0);
  // It stays "unknown" (never noted as an outcome), so the next try asks F-Link's folder again.
  assert.equal(journal.lookup(KEY).status, 'unknown');

  // Cut off by the app closing while F-Link still has it: unknown after a restart, never "still_queued".
  const stale = fresh();
  fs.writeFileSync(stale, JSON.stringify([{ key: 'p', job: 'job', status: 'printing', file: 'J-7', at: Date.now() }]));
  const restarted = openJournal(stale, { recover: () => ({ status: 'still_queued', message: null }) });
  restarted.settleStale();
  assert.equal(restarted.lookup('p').status, 'unknown');
});

test('unacknowledged entries stay; acknowledged ones go after the cap', async () => {
  let clock = 10_000;
  const journal = openJournal(fresh(), { now: () => clock });
  await journal.track('open', 'job', printed('1'));
  for (let n = 0; n < MAX_ENTRIES + 5; n += 1) {
    clock += 1;
    await journal.track(`k${n}`, 'job', printed(String(n)));
    journal.ack(`k${n}`);
  }
  assert.notEqual(journal.lookup('open'), null);
  assert.equal(journal.lookup('k0'), null);
  assert.notEqual(journal.lookup(`k${MAX_ENTRIES + 4}`), null);
});

test('a broken journal file is moved aside, never written over; a locked one is never replaced', async () => {
  const file = fresh();
  fs.writeFileSync(file, '{not json');
  const journal = openJournal(file);
  await journal.track(KEY, 'job', printed('3'));
  const aside = fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.broken-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(file), aside[0]), 'utf8'), '{not json');

  const lockedFile = fresh();
  fs.writeFileSync(lockedFile, JSON.stringify([{ key: 'old', job: 'job', status: 'printed', receiptNo: '1', at: Date.now() }]));
  const { fs: lockable, state } = lockableFs();
  state.reads = false;
  const locked = openJournal(lockedFile, { fs: lockable, retryMs: 10 });
  // Can't read it, so it can't note a new print: nothing prints, and the old file stays whole.
  assert.equal((await locked.track(KEY, 'job', printed('4'))).status, 'not_saved');
  assert.equal(JSON.parse(fs.readFileSync(lockedFile, 'utf8'))[0].key, 'old');
  state.reads = true;
  assert.equal(locked.lookup('old').receiptNo, '1');
});

test('without a valid key it only prints; a print that throws is noted as unknown', async () => {
  const journal = openJournal(fresh());
  assert.deepEqual(await journal.track(undefined, 'job', printed(null)), { status: 'printed', receiptNo: null });
  assert.equal(journal.lookup('../../etc'), null);
  await assert.rejects(
    journal.track(KEY, 'job', async () => {
      throw new Error('the day zip could not be read');
    }),
  );
  assert.equal(journal.lookup(KEY).status, 'unknown');
});

test('a receipt goes to F-Link only once the journal has noted the name of its file', async () => {
  const file = fresh();
  const { fs: lockable, state } = lockableFs();
  const journal = openJournal(file, { fs: lockable, retryMs: 10 });
  let published = false;
  const answer = await journal.track(KEY, 'job', async (onFile) => {
    // The intent was written; now the disk refuses the file's name.
    state.writes = false;
    if (onFile('J-1') === false) return { status: 'not_saved' };
    published = true;
    return { status: 'printed', receiptNo: '1' };
  });
  assert.equal(answer.status, 'not_saved');
  assert.equal(published, false);
  // Nothing went, so nothing is left to look up (and the next try may print).
  assert.equal(journal.lookup(KEY), null);
});

test('a receipt that may have printed is never printed again on a guess', async () => {
  const file = fresh();
  fs.writeFileSync(file, JSON.stringify([{ key: KEY, job: 'job', status: 'unknown', file: 'J-9', at: Date.now() }]));
  let sent = 0;
  const run = async () => {
    sent += 1;
    return { status: 'printed', receiptNo: '12' };
  };
  // F-Link's folder can't say: someone has to look at the printer.
  const unsure = openJournal(file, { recover: () => null });
  assert.deepEqual(await unsure.track(KEY, 'job', run), { status: 'check_printer', message: null });
  assert.equal(sent, 0);
  // An owner looked: none came out. It prints.
  assert.equal((await unsure.track(KEY, 'job', run, { confirmed: true })).receiptNo, '12');
  assert.equal(sent, 1);

  // F-Link's folder says it printed: its number comes back, nothing prints, even when confirmed.
  const other = fresh();
  fs.writeFileSync(other, JSON.stringify([{ key: KEY, job: 'job', status: 'unknown', file: 'J-9', at: Date.now() }]));
  const knows = openJournal(other, { recover: () => ({ status: 'printed', receiptNo: '55' }) });
  assert.deepEqual(await knows.track(KEY, 'job', run, { confirmed: true }), { status: 'printed', receiptNo: '55' });
  assert.equal(sent, 1);
  // F-Link's folder says it never went: it may print.
  const third = fresh();
  fs.writeFileSync(third, JSON.stringify([{ key: KEY, job: 'job', status: 'unknown', file: 'J-9', at: Date.now() }]));
  const never = openJournal(third, { recover: () => ({ status: 'not_running' }) });
  assert.equal((await never.track(KEY, 'job', run)).receiptNo, '12');
});

test('a receipt that may have printed is never let go, even when the till acknowledges it', async () => {
  let clock = 10_000;
  const file = fresh();
  fs.writeFileSync(file, JSON.stringify([{ key: 'maybe', job: 'job', status: 'unknown', file: 'J-1', at: 1, acked: true }]));
  const journal = openJournal(file, { now: () => clock });
  // Acknowledging it changes nothing: it is still there to say "look at the printer".
  await journal.track('other', 'job', async () => ({ status: 'unknown', message: null }));
  journal.ack('other');
  for (let n = 0; n < MAX_ENTRIES + 5; n += 1) {
    clock += 1;
    await journal.track(`k${n}`, 'job', printed(String(n)));
    journal.ack(`k${n}`);
  }
  clock += 400 * 24 * 3600_000;
  await journal.track('last', 'job', printed('x'));
  const reopened = openJournal(file);
  assert.equal(reopened.lookup('maybe').status, 'unknown');
  assert.equal(reopened.lookup('other').status, 'unknown');
  assert.equal(reopened.lookup('k0'), null);
});

test('an outcome the till never acknowledged stays, however old', async () => {
  const file = fresh();
  const old = Date.now() - 400 * 24 * 3600_000;
  fs.writeFileSync(file, JSON.stringify([{ key: 'old', job: 'job', status: 'printed', receiptNo: '3', at: old }]));
  const journal = openJournal(file);
  await journal.track(KEY, 'job', printed('4'));
  assert.equal(openJournal(file).lookup('old').receiptNo, '3');
});

test('a journal that can’t be read when a print starts never prints, even if it becomes readable a moment later', async () => {
  const file = fresh();
  fs.writeFileSync(file, JSON.stringify([{ key: KEY, job: 'job', status: 'printed', receiptNo: '9', at: Date.now(), acked: true }]));
  const { fs: lockable, state } = lockableFs();
  state.reads = false;
  const journal = openJournal(file, { fs: lockable, retryMs: 10 });
  let sent = 0;
  const pending = journal.track(KEY, 'job', async () => {
    sent += 1;
    return { status: 'printed', receiptNo: '10' };
  });
  // The antivirus lets go before the job's first step runs.
  state.reads = true;
  assert.equal((await pending).status, 'not_saved');
  assert.equal(sent, 0);
  assert.equal(journal.lookup(KEY).receiptNo, '9');
});

test('a lookup on a journal that can’t be read says unavailable, never "no receipt went"', () => {
  const file = fresh();
  fs.writeFileSync(file, JSON.stringify([{ key: KEY, job: 'job', status: 'printed', receiptNo: '9', at: Date.now() }]));
  const { fs: lockable, state } = lockableFs();
  state.reads = false;
  const journal = openJournal(file, { fs: lockable });
  assert.equal(journal.lookup(KEY).status, 'unavailable');
  state.reads = true;
  assert.equal(journal.lookup(KEY).status, 'printed');
});

test('a job noted as printing with no file name never reached F-Link: after a restart it reads as failed, not unknown', () => {
  const file = fresh();
  fs.writeFileSync(file, JSON.stringify([{ key: KEY, job: 'job', status: 'printing', file: null, at: Date.now() }]));
  let asked = 0;
  const journal = openJournal(file, { recover: () => ((asked += 1), null) });
  journal.settleStale();
  assert.equal(journal.lookup(KEY).status, 'failed');
  assert.equal(asked, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].status, 'failed');
});

test('a journal locked at start still settles its cut-off jobs once it can be read', () => {
  const file = fresh();
  fs.writeFileSync(file, JSON.stringify([{ key: KEY, job: 'job', status: 'printing', file: 'job', at: Date.now() }]));
  const { fs: lockable, state } = lockableFs();
  state.reads = false;
  const journal = openJournal(file, { fs: lockable, recover: () => ({ status: 'printed', receiptNo: '77' }) });
  assert.equal(journal.settleStale(), false);
  state.reads = true;
  assert.deepEqual([journal.lookup(KEY).status, journal.lookup(KEY).receiptNo], ['printed', '77']);
});
