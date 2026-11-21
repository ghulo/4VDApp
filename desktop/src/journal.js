// The fiscal printer's job journal, by the sale's key: written when a receipt
// goes to F-Link and again when F-Link answers. It lives in the app itself
// (memory first, then the app's settings folder on this PC's disk), not in the
// dashboard's storage, so a receipt's fate and its fiscal number survive a
// reload of the page, a crash of the page mid-print and a full browser
// storage: the Counter asks here before it lets go of a sale whose receipt
// was printing, and tells the journal (ack) once it has noted the outcome.
//
// - Memory is the truth while the app runs: a lookup answers from it even when
//   the disk can't be written (locked by an antivirus, full), and the disk is
//   written again until it takes it.
// - A receipt is only sent once the journal could note it is going (so it can
//   always be found again); if the disk refuses that, nothing prints.
// - A key that already printed is never printed again: its answer comes back.
//   A key still printing waits for that job instead of sending a second one.
// - The name of the file F-Link gets is noted before the file is put in its
//   folder (if the disk refuses, nothing prints), so its answer can always be
//   found there again after a crash.
// - "printing" means this running app has the job. One left "printing" when the
//   app starts was cut off by the app closing: F-Link's own folder says how it
//   went if it can (printed with its number, or failed), else it is "unknown"
//   (look at the printer).
// - An "unknown" receipt is never sent again on a guess: F-Link's folder is
//   asked first, and if it can't say, only an owner who looked at the printer
//   may print it again (confirmed).
// - Entries the Counter hasn't acknowledged stay until it does (up to a hard
//   cap); acknowledged ones go after MAX_ENTRIES or KEEP_MS.
// - A journal file that can't be read is never written over: a broken one is
//   moved aside first, a locked one waits until it can be read.
const realFs = require('node:fs');

/** Acknowledged entries: enough for weeks of receipts; the oldest go first. */
const MAX_ENTRIES = 500;
const KEEP_MS = 30 * 24 * 3600_000;
/** Entries the Counter never acknowledged (an older dashboard, a lost page): kept far longer, but not for ever. */
const MAX_UNACKED = 3000;
const KEEP_UNACKED_MS = 120 * 24 * 3600_000;
/** How often a write the disk refused is tried again. */
const RETRY_MS = 5_000;
const KEY = /^[A-Za-z0-9:-]{1,80}$/;
const OUTCOMES = new Set(['printed', 'failed', 'not_running', 'no_folder']);
/** How a receipt may have come out without anyone knowing: it may be on paper already. */
const AMBIGUOUS = new Set(['unknown', 'printing']);

const validKey = (key) => typeof key === 'string' && KEY.test(key);

/** What a lookup gives the dashboard. */
const view = (entry) => ({ key: entry.key, job: entry.job ?? null, status: entry.status, receiptNo: entry.receiptNo ?? null, message: entry.message ?? null, at: entry.at });

/** The answer a print gives back, from a noted outcome. */
const answerOf = (entry) =>
  entry.status === 'printed' ? { status: 'printed', receiptNo: entry.receiptNo ?? null } : { status: entry.status, message: entry.message ?? null };

/**
 * One journal on one file.
 * @param {string} file
 * @param {{ fs?: typeof realFs, now?: () => number, recover?: (entry: object) => ({ status: string, receiptNo?: string | null, message?: string | null } | null), retryMs?: number }} [options]
 *   recover: how a job cut off by the app closing went, from F-Link's folder (fiscal.js answerFor), or null when it can't say.
 */
function openJournal(file, options = {}) {
  const fs = options.fs ?? realFs;
  const now = options.now ?? Date.now;
  const retryMs = options.retryMs ?? RETRY_MS;
  /** key → entry; the order of insertion is the order of the last change. */
  const entries = new Map();
  /** key → the running print's promise: a second print of it waits for this one. */
  const inflight = new Map();
  // The disk's journal could be read (or there is none): only then is it written.
  let loaded = false;
  let dirty = false;
  let timer = null;

  /** Read the disk's journal into memory, under what memory already has (memory is newer). */
  function load() {
    if (loaded) return true;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') return false;
      loaded = true;
      return true;
    }
    let saved;
    try {
      saved = JSON.parse(text);
      if (!Array.isArray(saved)) throw new Error('not a list');
    } catch {
      // Broken: kept beside it for a person to look at, never written over.
      try {
        fs.renameSync(file, `${file}.broken-${now()}`);
      } catch {
        return false;
      }
      loaded = true;
      return true;
    }
    const mine = [...entries.values()];
    entries.clear();
    for (const entry of saved) if (entry && validKey(entry.key)) entries.set(entry.key, entry);
    for (const entry of mine) {
      entries.delete(entry.key);
      entries.set(entry.key, entry);
    }
    loaded = true;
    return true;
  }

  function pruned() {
    const at = now();
    const all = [...entries.values()];
    const acked = all.filter((entry) => entry.acked && entry.status !== 'printing' && at - entry.at < KEEP_MS).slice(-MAX_ENTRIES);
    const open = all.filter((entry) => !entry.acked || entry.status === 'printing').filter((entry) => at - entry.at < KEEP_UNACKED_MS).slice(-MAX_UNACKED);
    const keep = new Set([...acked, ...open]);
    for (const entry of all) if (!keep.has(entry)) entries.delete(entry.key);
    return all.filter((entry) => keep.has(entry));
  }

  /** Written under another name first, so a crash mid-write never leaves half a journal. False when it couldn't be. */
  function persist() {
    dirty = true;
    if (!load()) return schedule(), false;
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(pruned()));
      fs.renameSync(`${file}.tmp`, file);
      dirty = false;
      return true;
    } catch {
      schedule();
      return false;
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (dirty) persist();
    }, retryMs);
    timer.unref?.();
  }

  function put(key, change) {
    const old = entries.get(key);
    entries.delete(key);
    entries.set(key, { ...old, ...change, key, at: now() });
    return persist();
  }

  /** What happened to this sale's last receipt, or null if none went to the printer from this app. */
  function lookup(key) {
    if (!validKey(key)) return null;
    load();
    const entry = entries.get(key);
    if (!entry) return null;
    // "printing" only while this app really has the job; otherwise it was cut off, and how it went is unknown.
    if (entry.status === 'printing' && !inflight.has(key)) return { ...view(entry), status: 'unknown' };
    return view(entry);
  }

  /** How a job no longer running went, from F-Link's folder (null: it can't say). */
  function recovered(entry) {
    try {
      const found = entry.file && options.recover ? options.recover(entry) : null;
      return found && OUTCOMES.has(found.status) ? found : null;
    } catch {
      return null;
    }
  }

  /**
   * Print one job for a sale, noted before it goes and with its answer. Without
   * a valid key it just prints. `run(onFile)` prints; it calls onFile with the
   * file name F-Link will get before it puts the file there, and must not print
   * if onFile answers false (the journal couldn't keep the name).
   * `confirmed`: an owner looked at the printer and says the last one didn't come out.
   */
  async function track(key, name, run, { confirmed = false } = {}) {
    if (!validKey(key)) return run(() => true);
    load();
    const running = inflight.get(key);
    if (running) return running;
    let known = entries.get(key);
    // Printed already: a second fiscal receipt for one sale must never print. Its answer comes back instead.
    if (known?.status === 'printed') return answerOf(known);
    // It may have printed (the app closed mid-print, F-Link didn't answer in time): F-Link's folder first.
    if (known && AMBIGUOUS.has(known.status)) {
      const found = recovered(known);
      if (found) {
        put(key, { status: found.status, receiptNo: found.receiptNo ?? null, message: found.message ?? null });
        known = entries.get(key);
        if (found.status === 'printed') return answerOf(known);
      } else if (!confirmed) {
        // Nobody can say: never a second receipt on a guess. Someone looks at the printer; an owner may print it again.
        return { status: 'check_printer', message: null };
      }
    }
    const job = (async () => {
      // Yield first, so the job is listed as running before any of it happens.
      await null;
      // The journal must be able to find this print again before it goes; if the disk refuses, nothing prints.
      if (!put(key, { job: String(name).slice(0, 80), status: 'printing', receiptNo: null, message: null, file: null, acked: false })) {
        entries.delete(key);
        if (known) entries.set(key, known);
        return { status: 'not_saved', message: null };
      }
      let answer;
      try {
        answer = await run((fileName) => {
          const entry = entries.get(key);
          if (entry) entries.set(key, { ...entry, file: String(fileName).slice(0, 80) });
          // Only once the disk knows the file's name may it go to F-Link: after a crash its answer is found by that name.
          return persist();
        });
      } catch (error) {
        // It may have thrown after F-Link took the job: never called failed (that could print it twice).
        put(key, { status: 'unknown', message: error?.message ?? null });
        throw error;
      }
      if (answer?.status === 'not_saved') {
        // Its name couldn't be noted, so it never went: as it was before.
        entries.delete(key);
        if (known) entries.set(key, known);
        persist();
        return answer;
      }
      const status = OUTCOMES.has(answer?.status) ? answer.status : 'unknown';
      put(key, { status, receiptNo: answer?.receiptNo ?? null, message: answer?.message ?? null });
      return answer;
    })();
    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  /** The Counter noted this outcome on its side: the entry may go in time. */
  function ack(key) {
    if (!validKey(key)) return false;
    load();
    const entry = entries.get(key);
    if (!entry || entry.status === 'printing' || entry.acked) return Boolean(entry);
    entries.set(key, { ...entry, acked: true });
    return persist();
  }

  /** At start: a job left "printing" was cut off when the app closed. F-Link's folder says how it went, if it can; else it is unknown. */
  function settleStale() {
    load();
    let changed = false;
    for (const entry of [...entries.values()]) {
      if (entry.status !== 'printing' || inflight.has(entry.key)) continue;
      const found = recovered(entry);
      const status = found ? found.status : 'unknown';
      entries.set(entry.key, { ...entry, status, receiptNo: found?.receiptNo ?? null, message: found?.message ?? entry.message ?? null });
      changed = true;
    }
    return changed ? persist() : true;
  }

  return { lookup, track, ack, settleStale, flush: () => (dirty ? persist() : true) };
}

module.exports = { openJournal, validKey, MAX_ENTRIES, MAX_UNACKED, KEEP_MS };
