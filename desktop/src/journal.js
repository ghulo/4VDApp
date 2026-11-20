// The fiscal printer's job journal, on this PC's disk (the app's settings
// folder), by the sale's key: written when a receipt goes to F-Link and again
// when F-Link answers. It lives in the app itself, not in the dashboard's
// storage, so a receipt's fate and its fiscal number survive a reload of the
// page, a crash of the page mid-print and a full browser storage: the Counter
// asks here before it lets go of a sale whose receipt was printing.
//
// A job still "printing" when the app starts was cut off by the app closing:
// it becomes "unknown" (look at the printer). So "printing" always means this
// running app still has the job.
const fs = require('node:fs');

/** Enough for weeks of receipts; the oldest go first. */
const MAX_ENTRIES = 500;
const KEEP_MS = 30 * 24 * 3600_000;
const KEY = /^[A-Za-z0-9:-]{1,80}$/;
const OUTCOMES = new Set(['printed', 'failed', 'not_running', 'no_folder']);

const validKey = (key) => typeof key === 'string' && KEY.test(key);

function read(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(saved) ? saved.filter((entry) => entry && validKey(entry.key)) : [];
  } catch {
    return [];
  }
}

/** Written under another name first, so a crash mid-write never leaves half a journal. False when it couldn't be. */
function write(file, entries, now = Date.now()) {
  const kept = entries.filter((entry) => now - entry.at < KEEP_MS).slice(-MAX_ENTRIES);
  try {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(kept));
    fs.renameSync(`${file}.tmp`, file);
    return true;
  } catch {
    return false;
  }
}

function put(file, key, change, now = Date.now()) {
  if (!validKey(key)) return false;
  const entries = read(file);
  const old = entries.find((entry) => entry.key === key);
  const others = entries.filter((entry) => entry.key !== key);
  return write(file, [...others, { ...old, ...change, key, at: now }], now);
}

/** A receipt for this sale goes to F-Link now. */
function start(file, key, job, now = Date.now()) {
  return put(file, key, { job: String(job).slice(0, 80), status: 'printing', receiptNo: null, message: null }, now);
}

/** F-Link answered ({ status, receiptNo?, message? } as fiscal.send gives it). */
function finish(file, key, answer, now = Date.now()) {
  const status = OUTCOMES.has(answer?.status) ? answer.status : 'unknown';
  return put(file, key, { status, receiptNo: answer?.receiptNo ?? null, message: answer?.message ?? null }, now);
}

/** What happened to this sale's last receipt, or null if none went to the printer from this app. */
function lookup(file, key) {
  if (!validKey(key)) return null;
  const entry = read(file).find((one) => one.key === key);
  return entry ? { key: entry.key, job: entry.job ?? null, status: entry.status, receiptNo: entry.receiptNo ?? null, message: entry.message ?? null, at: entry.at } : null;
}

/**
 * Print one job for a sale, noted before it goes and with its answer. A print
 * that throws is noted as unknown (look at the printer): it may have thrown
 * after F-Link took the job, so it is never called failed (that could print it
 * twice), and it never stays "printing" until the app restarts. Without a
 * valid key it just prints.
 */
async function track(file, key, name, run) {
  if (!validKey(key)) return run();
  start(file, key, name);
  try {
    const answer = await run();
    finish(file, key, answer);
    return answer;
  } catch (error) {
    finish(file, key, { status: 'unknown', message: error?.message ?? null });
    throw error;
  }
}

/** At start: a job left "printing" was cut off when the app closed, so whether it printed is unknown. */
function settleStale(file, now = Date.now()) {
  const entries = read(file);
  if (!entries.some((entry) => entry.status === 'printing')) return true;
  return write(file, entries.map((entry) => (entry.status === 'printing' ? { ...entry, status: 'unknown' } : entry)), now);
}

module.exports = { start, finish, lookup, settleStale, track, validKey, MAX_ENTRIES };
