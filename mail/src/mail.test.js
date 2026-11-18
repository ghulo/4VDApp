import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aligned, checkSender } from './auth.js';
import { billFiles } from './files.js';

const ar = (value) => ({ key: 'Authentication-Results', value });

test('a forward from Gmail passes on its DKIM', () => {
  const headers = [ar('mx.cloudflare.net; dkim=pass header.d=gmail.com header.s=20230601; spf=pass smtp.mailfrom=owner@gmail.com; dmarc=pass header.from=gmail.com')];
  assert.equal(checkSender(headers, 'owner@gmail.com', 'owner@gmail.com').ok, true);
});

test('a faked From fails when the checks passed for another domain', () => {
  const headers = [ar('mx.cloudflare.net; dkim=pass header.d=evil.com; spf=pass smtp.mailfrom=x@evil.com; dmarc=fail header.from=gmail.com')];
  assert.equal(checkSender(headers, 'owner@gmail.com', 'x@evil.com').ok, false);
});

test("a pass written by the sender below Cloudflare's own failing results is ignored", () => {
  const headers = [
    ar('mx.cloudflare.net; dkim=none; spf=fail smtp.mailfrom=x@evil.com; dmarc=fail header.from=gmail.com'),
    ar('mx.cloudflare.net; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com'),
  ];
  assert.equal(checkSender(headers, 'owner@gmail.com', 'x@evil.com').ok, false);
});

test('results not stamped by Cloudflare count for nothing', () => {
  const headers = [ar('mx.google.com; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com')];
  assert.deepEqual(checkSender(headers, 'owner@gmail.com', 'owner@gmail.com'), { ok: false, why: 'no Cloudflare authentication results' });
  assert.equal(checkSender([], 'owner@gmail.com', 'owner@gmail.com').ok, false);
});

test("ARC results from Cloudflare count, and SPF without smtp.mailfrom uses the envelope sender", () => {
  const headers = [{ key: 'ARC-Authentication-Results', value: 'i=2; mx.cloudflare.net; spf=pass' }];
  assert.equal(checkSender(headers, 'bills@fresh.al', 'bounce@mail.fresh.al').ok, true);
  assert.equal(checkSender(headers, 'bills@fresh.al', 'bounce@other.al').ok, false);
});

test('aligned keeps subdomains together but not look-alikes', () => {
  assert.equal(aligned('mail.fresh.al', 'fresh.al'), true);
  assert.equal(aligned('notfresh.al', 'fresh.al'), false);
  assert.equal(aligned('com', 'fresh.com'), false);
});

test('PDFs win over photos; small images are ignored; at most five', () => {
  const file = (filename, mimeType, bytes) => ({ filename, mimeType, content: new Uint8Array(bytes).buffer });
  assert.deepEqual(billFiles([file('logo.png', 'image/png', 5000), file('a.pdf', 'application/pdf', 10)]).map((f) => f.name), ['a.pdf']);
  assert.deepEqual(billFiles([file('logo.png', 'image/png', 5000), file('IMG.jpg', 'image/jpeg', 200 * 1024)]).map((f) => f.name), ['IMG.jpg']);
  assert.equal(billFiles(Array.from({ length: 7 }, (_, i) => file(`${i}.pdf`, 'application/pdf', 10))).length, 5);
});

test('an unknown bill address says so; anything else asks to send again', async () => {
  const { rejectReason } = await import('./reply.js');
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  assert.match(await rejectReason(json(404, { error: 'UNKNOWN_BILL_ADDRESS' })), /No 4VD business uses this address/);
  assert.match(await rejectReason(json(500, { error: 'INTERNAL' })), /send it again/);
  assert.match(await rejectReason(new Response('bad gateway', { status: 502 })), /send it again/);
});
