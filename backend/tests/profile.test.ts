import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#1d5c45' } }).png().toBuffer();

describe('my profile', () => {
  it('should update name, phone and theme', async () => {
    const response = await api()
      .put('/api/me/profile')
      .set(auth(employeeToken))
      .send({ name: 'Ana Kovač', phone: '+383 44 123 456', theme: 'dark' });
    const me = await api().get('/api/auth/me').set(auth(employeeToken));

    expect(response.status).toBe(200);
    expect(me.body.data).toMatchObject({ name: 'Ana Kovač', phone: '+383 44 123 456', theme: 'dark', avatarUrl: null });
  });

  it('should shrink a photo to a small WebP and serve it to anyone with the link', async () => {
    const upload = await api()
      .put('/api/me/avatar')
      .set(auth(employeeToken))
      .set('Content-Type', 'image/png')
      .send(await photo(1600, 1200));
    const avatarUrl = upload.body.data.avatarUrl as string;
    const served = await api().get(avatarUrl).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    const size = await sharp(served.body as Buffer).metadata();

    expect(upload.status).toBe(200);
    expect(avatarUrl).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toContain('immutable');
    // The dashboard and the app live on other addresses than the API.
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(Math.max(size.width!, size.height!)).toBeLessThanOrEqual(256);
  });

  it('should refuse a file that is not an image, or is too big', async () => {
    const notImage = await api()
      .put('/api/me/avatar')
      .set(auth(employeeToken))
      .set('Content-Type', 'image/png')
      .send(Buffer.from('definitely not a picture'));
    const tooBig = await api()
      .put('/api/me/avatar')
      .set(auth(employeeToken))
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(6 * 1024 * 1024, 1));

    expect(notImage.status).toBe(400);
    expect(tooBig.status).toBe(413);
  });

  it('should remove a photo', async () => {
    await api().put('/api/me/avatar').set(auth(employeeToken)).set('Content-Type', 'image/png').send(await photo(300, 300));

    const removed = await api().delete('/api/me/avatar').set(auth(employeeToken));

    expect(removed.body.data.avatarUrl).toBeNull();
  });
});

describe('business profile', () => {
  it('should let everyone read it and only the owner change it', async () => {
    const update = await api()
      .put('/api/business')
      .set(auth(adminToken))
      .send({ name: '4VD Home', address: 'Rruga e Dëshmorëve 12, Pejë', phone: '+383 39 000 000', timeZone: 'Europe/Belgrade' });
    const read = await api().get('/api/business').set(auth(employeeToken));
    const asEmployee = await api().put('/api/business').set(auth(employeeToken)).send({ name: 'Mine now' });

    expect(update.status).toBe(200);
    expect(read.body.data).toMatchObject({ name: '4VD Home', timeZone: 'Europe/Belgrade', currency: 'EUR', logoUrl: null });
    expect(asEmployee.status).toBe(403);
  });

  it('should refuse a time zone that does not exist', async () => {
    const response = await api().put('/api/business').set(auth(adminToken)).send({ timeZone: 'Mars/Olympus' });

    expect(response.status).toBe(400);
  });

  it('should take a logo', async () => {
    const response = await api()
      .put('/api/business/logo')
      .set(auth(adminToken))
      .set('Content-Type', 'image/png')
      .send(await photo(2000, 800));

    expect(response.body.data.logoUrl).toMatch(/^\/api\/media\//);
  });
});

describe('broken requests', () => {
  it('should answer malformed JSON with 400, not a server error', async () => {
    const response = await api().put('/api/me/profile').set(auth(employeeToken)).set('Content-Type', 'application/json').send('{"name":');

    expect(response.status).toBe(400);
  });
});
