import { expect, test as setup } from '@playwright/test';
import { apiAs, thisMonth, USERS } from './api';

/**
 * Fixed data every flow starts from: books open from last month, two products
 * (18% and 8% VAT), a supplier and one employee. Then a signed-in browser per
 * user, saved for the flows.
 */
setup('seed the shop and sign in', async ({ browser }) => {
  const admin = await apiAs('admin');
  const [year, month] = thisMonth().split('-').map(Number) as [number, number];
  const startMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  await admin.put('/api/books/settings', { startDay: `${startMonth}-01` });
  const category = await admin.post('/api/categories', { name: 'Ushqime' });
  await admin.post('/api/products', {
    name: 'E2E Kafe',
    sku: 'E2E-KAFE',
    barcode: '3800000000017',
    price: 11.8,
    costPrice: 6,
    stock: 100,
    vatRate: 18,
    categoryId: category.id,
  });
  await admin.post('/api/products', {
    name: 'E2E Bukë',
    sku: 'E2E-BUKE',
    barcode: '3800000000024',
    price: 1.08,
    costPrice: 0.5,
    stock: 100,
    vatRate: 8,
    categoryId: category.id,
  });
  await admin.post('/api/suppliers', {
    name: 'E2E Furnitori',
    nui: '811234567',
  });
  await admin.put('/api/me/profile', { language: 'en' });
  await admin.dispose();

  const owner = await apiAs('owner');
  await owner.post('/api/payroll/employees', {
    name: 'Arta Krasniqi',
    personalNumber: '1234567890',
    contract: 'open',
    startedOn: '2025-01-01',
    payBasis: 'gross',
    payAmount: 500,
    bankAccount: '1501 0000 0000 0001',
  });
  await owner.put('/api/me/profile', { language: 'en' });
  await owner.dispose();

  for (const user of ['admin', 'owner'] as const) {
    const page = await browser.newPage();
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(USERS[user].email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(USERS[user].password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.context().storageState({ path: `.auth/${user}.json` });
    await page.close();
  }
});
