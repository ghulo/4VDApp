import { expect, test } from '@playwright/test';
import { apiAs, productBySku, entriesFor, readLines, thisMonth } from './api';

test.use({ storageState: '.auth/admin.json' });

test('a supplier bill puts goods in stock, posts to the books and lands in the VAT month', async ({ page }) => {
  const api = await apiAs('admin');
  const product = await productBySku(api, 'E2E-KAFE');
  const stockBefore = product.stock.quantity;
  const before = (await api.get(`/api/vat/${thisMonth()}`)).boxes as Record<number, number>;

  await page.goto('/bills/new');
  await page.getByRole('combobox', { name: 'Supplier' }).fill('E2E Furn');
  await page.getByRole('option', { name: /E2E Furnitori/ }).click();
  await page.getByRole('textbox', { name: 'Supplier’s invoice no.' }).fill('E2E-B1');
  const line = page.getByRole('group', { name: 'Line 1' });
  await line.getByRole('combobox', { name: /^Product/ }).fill('E2E Kafe');
  await page.getByRole('option', { name: /E2E Kafe/ }).click();
  await line.getByRole('spinbutton', { name: 'How many' }).fill('10');
  // €7.08 a piece with 18% VAT inside: €70.80 in all, €60.00 net and €10.80 VAT.
  await line.getByRole('spinbutton', { name: 'Price for one (€)' }).fill('7.08');
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page).not.toHaveURL(/\/bills\/new/);

  const bills = await api.get('/api/bills?search=E2E-B1');
  const bill = (bills.bills ?? bills).find((one: { number: string }) => one.number === 'E2E-B1');
  expect(bill.amount).toBe(70.8);
  expect((await api.get(`/api/products/${product.id}`)).stock.quantity).toBe(stockBefore + 10);

  const [entry] = await entriesFor(api, 'bill', bill.id);
  expect(readLines(entry!)).toEqual(['1260 Dr 10.8', '1340 Dr 60', '2000 Cr 70.8'].sort());

  const after = (await api.get(`/api/vat/${thisMonth()}`)).boxes as Record<number, number>;
  expect(Math.round((after[43]! - (before[43] ?? 0)) * 100)).toBe(6000);
  expect(Math.round((after[44]! - (before[44] ?? 0)) * 100)).toBe(1080);
  await api.dispose();
});
