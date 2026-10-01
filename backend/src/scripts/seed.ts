import 'dotenv/config';
import { sql } from 'kysely';
import { loadConfig } from '../config/env.js';
import { createDatabase, type DatabaseClient } from '../database/connection.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../utils/password.js';
import { logger } from '../utils/logger.js';

/**
 * Usage:
 *   npm run seed            -> starter categories + the admin account
 *   npm run seed -- --demo  -> also adds demo products (for local testing only)
 *
 * Safe to run more than once: existing rows are left alone.
 */

// Edit this list to match what the business actually sells.
const STARTER_CATEGORIES = [
  { name: 'Furniture', description: 'Tables, chairs, shelves and other furniture' },
  { name: 'Decor', description: 'Decorative items for the home' },
  { name: 'Lighting', description: 'Lamps and light fixtures' },
  { name: 'Textiles', description: 'Rugs, curtains, cushions and bedding' },
];

const DEMO_PRODUCTS = [
  { name: 'Oak Dining Chair', category: 'Furniture', price: 89, cost: 45, stock: 40, sku: 'FUR-CHAIR-OAK', tiers: [[10, 80], [50, 72]] },
  { name: 'Walnut Coffee Table', category: 'Furniture', price: 249, cost: 130, stock: 6, sku: 'FUR-TABLE-WAL', tiers: [[5, 229]] },
  { name: 'Ceramic Vase', category: 'Decor', price: 35, cost: 12, stock: 120, sku: 'DEC-VASE-CER', tiers: [[20, 30], [100, 25]] },
  { name: 'Brass Floor Lamp', category: 'Lighting', price: 159, cost: 70, stock: 3, sku: 'LGT-LAMP-BRS', tiers: [] },
  { name: 'Wool Area Rug', category: 'Textiles', price: 199, cost: 95, stock: 15, sku: 'TEX-RUG-WOOL', tiers: [[5, 185]] },
] as const;

async function seedCategories(db: DatabaseClient): Promise<void> {
  for (const category of STARTER_CATEGORIES) {
    const existing = await db
      .selectFrom('categories')
      .select('id')
      .where(sql<string>`lower(name)`, '=', category.name.toLowerCase())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!existing) {
      await db.insertInto('categories').values(category).execute();
    }
  }
  logger.info('Categories ready', { count: STARTER_CATEGORIES.length });
}

async function seedAdmin(db: DatabaseClient): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Admin';

  if (!email || !password) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env before seeding');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
  if (existing) {
    logger.info('Admin account already exists, leaving it unchanged', { email });
    return;
  }

  await db
    .insertInto('users')
    .values({ email, name, role: 'admin', password_hash: await hashPassword(password) })
    .execute();
  logger.info('Admin account created', { email });
}

async function seedDemoProducts(db: DatabaseClient): Promise<void> {
  const categories = await db.selectFrom('categories').select(['id', 'name']).where('deleted_at', 'is', null).execute();
  const categoryIdByName = new Map(categories.map((category) => [category.name, category.id]));

  for (const demo of DEMO_PRODUCTS) {
    const categoryId = categoryIdByName.get(demo.category);
    if (!categoryId) continue;

    const existing = await db.selectFrom('products').select('id').where('sku', '=', demo.sku).executeTakeFirst();
    if (existing) continue;

    await db.transaction().execute(async (trx) => {
      const product = await trx
        .insertInto('products')
        .values({ name: demo.name, category_id: categoryId, base_price: demo.price, cost_price: demo.cost, sku: demo.sku })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('inventory').values({ product_id: product.id, quantity_on_hand: demo.stock }).execute();
      for (const [quantityMin, price] of demo.tiers) {
        await trx.insertInto('bulk_pricing_tiers').values({ product_id: product.id, quantity_min: quantityMin, price }).execute();
      }
    });
  }
  logger.info('Demo products ready', { count: DEMO_PRODUCTS.length });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.databaseUrl);
  try {
    await seedCategories(db);
    await seedAdmin(db);
    if (process.argv.includes('--demo')) {
      await seedDemoProducts(db);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  logger.error('Seeding failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
