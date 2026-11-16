import type { NextFunction, Request, Response } from 'express';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enterBusiness, requestContext, runAsBusiness } from '../src/database/businessContext.js';
import { createDatabase, type DatabaseClient } from '../src/database/connection.js';
import { resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
/** Two connections only, so the two businesses below keep handing the same connections back and forth. */
let small: DatabaseClient;
let shopId: number;
let otherId: number;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seen(db: DatabaseClient): Promise<string> {
  const { rows } = await sql<{ id: string }>`select current_setting('app.business_id', true) as id`.execute(db);
  return rows[0]!.id;
}

beforeAll(async () => {
  context = await setupTestApp();
  await resetData(context.db);
  shopId = (await context.db.selectFrom('businesses').select('id').executeTakeFirstOrThrow()).id;
  otherId = (await context.db.insertInto('businesses').values({ name: 'Other shop' }).returning('id').executeTakeFirstOrThrow()).id;
  small = createDatabase(process.env.TEST_DATABASE_URL!, 2);
});
afterAll(async () => {
  await small.destroy();
  await context.db.destroy();
});

describe('each piece of work sees only its own business', () => {
  it('keeps two businesses apart when their queries interleave on a pool of two', async () => {
    const run = (businessId: number, delay: number) =>
      runAsBusiness(businessId, async () => {
        const values: string[] = [];
        for (let i = 0; i < 15; i++) {
          values.push(await seen(small));
          await pause(delay);
        }
        return values;
      });
    const [shop, other, shopAgain] = await Promise.all([run(shopId, 1), run(otherId, 2), run(shopId, 3)]);
    expect(new Set(shop)).toEqual(new Set([String(shopId)]));
    expect(new Set(other)).toEqual(new Set([String(otherId)]));
    expect(new Set(shopAgain)).toEqual(new Set([String(shopId)]));
  });

  it('keeps a transaction in its business across awaits, and new rows take that business', async () => {
    const run = (businessId: number, name: string) =>
      runAsBusiness(businessId, () =>
        small.transaction().execute(async (trx) => {
          const before = await seen(trx);
          await pause(20);
          const row = await trx.insertInto('categories').values({ name }).returning('business_id').executeTakeFirstOrThrow();
          await pause(20);
          return { before, after: await seen(trx), stored: row.business_id };
        }),
      );
    const [shop, other] = await Promise.all([run(shopId, 'Tea'), run(otherId, 'Tea')]);
    expect(shop).toEqual({ before: String(shopId), after: String(shopId), stored: shopId });
    expect(other).toEqual({ before: String(otherId), after: String(otherId), stored: otherId });
  });

  it('clears the business on a connection that is reused without one', async () => {
    await runAsBusiness(otherId, () => seen(small));
    await runAsBusiness(otherId, () => seen(small));
    // Outside any business: never the previous work's business.
    expect(await Promise.all([seen(small), seen(small)])).toEqual(['', '']);
  });

  it('refuses a request that touches business data before naming its business', async () => {
    const inRequest = <T>(work: () => Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        requestContext({} as Request, {} as Response, (() => work().then(resolve, reject)) as NextFunction);
      });
    await expect(inRequest(() => small.selectFrom('products').select('id').execute())).rejects.toThrow(/products ran without a business/);
    // Global tables are fine, and naming the business lets the rest through.
    await expect(inRequest(() => small.selectFrom('users').select('id').execute())).resolves.toEqual([]);
    await expect(
      inRequest(async () => {
        enterBusiness(shopId);
        return small.selectFrom('products').select('id').execute();
      }),
    ).resolves.toEqual([]);
  });
});
