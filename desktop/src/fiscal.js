// The fiscal printer, through Enternet's F-Link: the Datecs printer's driver
// watches a folder (C:\TEMP) for "*.inp" files, one command per line, prints
// each one and then
//   - on success renames it to "*.in$", every line echoed with "Ok" and the
//     printer's receipt number, and moves it into Printed\<day>.zip;
//   - on failure moves it to PrintErrors\ and writes the reason in FLink.err.
// TREFIN talks to the printer the same way. The dashboard writes the lines;
// this file only carries them to the folder and reads the answer back.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');

const FOLDER = process.env.FLINK_FOLDER || 'C:\\TEMP';
const POLL_MS = 250;
// F-Link checks the folder every half second; a receipt prints in a few seconds.
const WAIT_MS = Number(process.env.FLINK_WAIT_MS) || 25_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) => fs.existsSync(file);

/** Only letters, digits and dashes reach the file name. */
function safeName(name) {
  const clean = String(name).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 60);
  if (!clean) throw new Error('A print job needs a name');
  return clean;
}

/** F-Link reads ANSI text: Albanian letters survive, anything else becomes "?". */
function encode(text) {
  const lines = String(text).replace(/\r?\n/g, '\r\n');
  return Buffer.from(lines.replace(/[^\x00-\xff]/g, '?'), 'latin1');
}

/** Today's day as F-Link names its zip, "2026-10-18". */
function dayName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** One file out of a zip (stored or deflated), or null. Enough for F-Link's daily zips. */
function readFromZip(zipFile, wanted) {
  let data;
  try {
    data = fs.readFileSync(zipFile);
  } catch {
    return null;
  }
  // The end-of-central-directory record sits in the last 64 KB.
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_558); i -= 1) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const target = wanted.toLowerCase();
  for (let n = 0; n < count && data.readUInt32LE(at) === 0x02014b50; n += 1) {
    const method = data.readUInt16LE(at + 10);
    const size = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString('latin1', at + 46, at + 46 + nameLength);
    if (path.basename(name).toLowerCase() === target) {
      const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
      const body = data.subarray(start, start + size);
      try {
        return (method === 8 ? zlib.inflateRawSync(body) : body).toString('latin1');
      } catch {
        return null;
      }
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/**
 * F-Link's answer: each line comes back as "S,1,001756,3,Ok;…". The receipt's
 * line "J,…;LastReceiptNumber;<receipt>;<all documents>" gives the number the
 * printer gave the receipt.
 */
function parseAnswer(text) {
  const lines = text.split(/\r?\n/).filter((line) => /^[A-Za-z],/.test(line));
  const failed = lines.find((line) => {
    const head = line.split(';')[0].split(',');
    return head.length >= 5 && head[4] !== 'Ok';
  });
  const receipt = lines.find((line) => line.includes(';LastReceiptNumber;'));
  return {
    ok: !failed,
    receiptNo: receipt ? receipt.split(';')[2] || null : null,
    message: failed ? failed.split(';')[0].split(',').slice(4).join(',') : null,
  };
}

/** F-Link's last error, when it is about this job. */
function errorFor(name) {
  try {
    const text = fs.readFileSync(path.join(FOLDER, 'FLink.err'), 'latin1');
    const [where, ...rest] = text.split(/\r?\n/).filter((line) => line.trim());
    if (where && where.toLowerCase().includes(name.toLowerCase())) return rest.join(' ').trim() || null;
  } catch {
    // No error file yet.
  }
  return null;
}

/** Is F-Link running on this PC? */
function flinkRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq FLink.exe', '/NH'], { windowsHide: true }, (error, stdout) => {
      resolve(!error && /flink\.exe/i.test(stdout));
    });
  });
}

async function status() {
  const folder = exists(FOLDER);
  return { folder, flink: folder ? await flinkRunning() : false, path: FOLDER };
}

/**
 * Hand one job to F-Link and wait for its answer:
 *   { status: 'printed', receiptNo }
 *   { status: 'failed', message }      F-Link refused it (out of paper, …)
 *   { status: 'not_running' }          nobody picked it up; the job was taken back
 *   { status: 'no_folder' }            no C:\TEMP on this PC
 */
async function send({ name, text }) {
  if (!exists(FOLDER)) return { status: 'no_folder' };
  let job = safeName(name);
  // A name F-Link already used would mix up the answers.
  for (let n = 2; [`${job}.inp`, `${job}.in$`].some((file) => exists(path.join(FOLDER, file))) || exists(path.join(FOLDER, 'PrintErrors', `${job}.inp`)); n += 1) {
    job = `${safeName(name)}-${n}`;
  }
  const inp = path.join(FOLDER, `${job}.inp`);
  // Written under another name first, so F-Link never reads half a file.
  const temp = path.join(FOLDER, `${job}.4vd`);
  fs.writeFileSync(temp, encode(text));
  fs.renameSync(temp, inp);

  const started = Date.now();
  while (Date.now() - started < WAIT_MS) {
    await sleep(POLL_MS);
    if (exists(inp)) continue;
    if (exists(path.join(FOLDER, 'PrintErrors', `${job}.inp`))) {
      await sleep(POLL_MS);
      return { status: 'failed', message: errorFor(job) };
    }
    // Printed: the answer is beside it for a moment, then in the day's zip.
    for (let tries = 0; tries < 12; tries += 1) {
      const loose = path.join(FOLDER, `${job}.in$`);
      const answer = exists(loose) ? safeRead(loose) : readFromZip(path.join(FOLDER, 'Printed', `${dayName()}.zip`), `${job}.in$`) ?? safeRead(path.join(FOLDER, 'Printed', `${job}.in$`));
      if (answer) {
        const parsed = parseAnswer(answer);
        return parsed.ok ? { status: 'printed', receiptNo: parsed.receiptNo } : { status: 'failed', message: parsed.message };
      }
      if (exists(path.join(FOLDER, 'PrintErrors', `${job}.inp`))) return { status: 'failed', message: errorFor(job) };
      await sleep(POLL_MS);
    }
    return { status: 'printed', receiptNo: null };
  }
  // Nobody took it: take it back so it can't print by itself later and be printed twice.
  try {
    fs.unlinkSync(inp);
    return { status: 'not_running' };
  } catch {
    return { status: 'failed', message: null };
  }
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'latin1');
  } catch {
    return null;
  }
}

module.exports = { send, status, parseAnswer, readFromZip, encode, safeName, FOLDER };
