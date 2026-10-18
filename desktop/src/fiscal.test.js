// node --test src/  (no Electron needed: fiscal.js only touches files)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { test } = require('node:test');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'flink-'));
fs.mkdirSync(path.join(folder, 'PrintErrors'));
fs.mkdirSync(path.join(folder, 'Printed'));
process.env.FLINK_FOLDER = folder;
process.env.FLINK_WAIT_MS = '1500';
const fiscal = require('./fiscal.js');

/** A zip holding one deflated file, as WinRAR writes F-Link's daily archives. */
function zipOf(name, text) {
  const body = zlib.deflateRawSync(Buffer.from(text, 'latin1'));
  const nameBytes = Buffer.from(name, 'latin1');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralAt = local.length + nameBytes.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralAt, 16);
  return Buffer.concat([local, nameBytes, body, central, nameBytes, end]);
}

/** Plays F-Link once: takes the next *.inp and answers it the way the real one does. */
function fakeFlink(answer) {
  const timer = setInterval(() => {
    const file = fs.readdirSync(folder).find((name) => name.endsWith('.inp'));
    if (!file) return;
    clearInterval(timer);
    answer(file, fs.readFileSync(path.join(folder, file), 'latin1'));
  }, 50);
}

test('prints a receipt and reads the receipt number from the day zip', async () => {
  fakeFlink((file, text) => {
    assert.match(text, /^S,1,______,_,__;Kafe Prince;1\.30;2;1;1;5;0;1764;0\.00\r\n/);
    assert.ok(text.includes('Ju faleminderit!'));
    const echoed = text.split('\r\n').filter(Boolean).map((line, index) => line.replace('______,_,__', `001756,${index + 1},Ok`));
    const answer = [...echoed, 'J,1,001756,4,Ok;LastReceiptNumber;20156;21396'].join('\r\n');
    fs.unlinkSync(path.join(folder, file));
    const day = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    fs.writeFileSync(path.join(folder, 'Printed', `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}.zip`), zipOf(file.replace('.inp', '.in$'), answer));
  });
  const result = await fiscal.send({
    name: '4VD-INV-26-000123',
    text: 'S,1,______,_,__;Kafe Prince;1.30;2;1;1;5;0;1764;0.00\nQ,1,______,_,__;1;Ju faleminderit!\nT,1,______,_,__;0;5\n',
  });
  assert.deepEqual(result, { status: 'printed', receiptNo: '20156' });
});

test("says why F-Link refused a receipt", async () => {
  fakeFlink((file) => {
    fs.renameSync(path.join(folder, file), path.join(folder, 'PrintErrors', file));
    fs.writeFileSync(path.join(folder, 'FLink.err'), `C:\\TEMP\\${file}:\r\n\r\nRELOAD NEW PAPER!!! (Error #13)\r\n`, 'latin1');
  });
  const result = await fiscal.send({ name: '4VD-INV-26-000124', text: 'S,1,______,_,__;Ujë;0.30;1;1;1;5;0;12;0.00\n' });
  assert.deepEqual(result, { status: 'failed', message: 'RELOAD NEW PAPER!!! (Error #13)' });
});

test('takes the job back when F-Link is not running, so it never prints twice', async () => {
  const result = await fiscal.send({ name: '4VD-X', text: 'X,1,______,_,__;\n' });
  assert.deepEqual(result, { status: 'not_running' });
  assert.deepEqual(fs.readdirSync(folder).filter((name) => name.endsWith('.inp')), []);
});

test('keeps names safe and Albanian letters readable for F-Link', () => {
  assert.equal(fiscal.safeName('../4VD INV/26'), '---4VD-INV-26');
  assert.equal(fiscal.encode('Çaj me limon ë €\n').toString('latin1'), 'Çaj me limon ë ?\r\n');
  assert.deepEqual(fiscal.parseAnswer('S,1,001756,1,Ok;A;1;1\r\nT,1,001756,2,Error 13;0;5\r\n'), { ok: false, receiptNo: null, message: 'Error 13' });
});
