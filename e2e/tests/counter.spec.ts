import { expect, test } from '@playwright/test';
import { apiAs, productBySku, entriesFor, readLines, thisMonth } from './api';

test.use({ storageState: '.auth/admin.json' });

test('a Counter sale shows its receipt and posts to the books and the VAT month', async ({ page }) => {
  const api = await apiAs('admin');
  const before = (await api.get(`/api/vat/${thisMonth()}`)).boxes as Record<number, number>;
  // The cost moves with purchases (another flow may have bought at a new price), so read it first.
  const product = await productBySku(api, 'E2E-KAFE');
  const cost = Math.round(2 * product.costPrice * 100) / 100;

  await page.goto('/counter');
  const scan = page.getByRole('textbox', { name: 'Scan or type a product' });
  await scan.fill('E2E-KAFE');
  await scan.press('Enter');
  await scan.fill('E2E-KAFE');
  await scan.press('Enter');
  await expect(page.getByRole('table', { name: 'Lines in this basket' }).getByRole('cell', { name: '€23.60' })).toBeVisible();

  await page.getByRole('button', { name: /^Pay/ }).click();
  const pay = page.getByRole('form', { name: 'Pay €23.60' });
  await pay.getByRole('button', { name: '€25.00' }).click();
  await pay.getByRole('button', { name: 'Record sale · €23.60' }).click();

  // The receipt: the last sale with its invoice number, total and change.
  const receipt = page.locator('details.counter-card').filter({ hasText: 'Last sale' });
  await expect(receipt).toContainText('€23.60');
  const number = (await receipt.locator('.counter-card__mono').textContent())!.trim();
  expect(number).toMatch(/^F-\d{4}-\d+$/);
  await receipt.locator('summary').click();
  await expect(receipt).toContainText('€1.40');

  // The books, to the cent: €23.60 cash in, €20.00 sales, €3.60 VAT owed (18% inside), two pieces' cost out of stock.
  const { checkouts } = await api.get(`/api/sales/checkouts?search=${encodeURIComponent(number)}`);
  const checkout = checkouts.find((one: { invoice: { number: string } | null }) => one.invoice?.number === number);
  expect(checkout.total).toBe(23.6);
  const saleId: number = checkout.lines[0].id ?? checkout.lines[0].saleId;
  const [entry] = await entriesFor(api, 'sale', saleId);
  const lines = readLines(entry!);
  expect(lines).toEqual(expect.arrayContaining([`1340 Cr ${cost}`, '2340 Cr 3.6', '4000 Cr 20', `5000 Dr ${cost}`]));
  expect(lines.filter((line) => line.startsWith('11') && line.includes('Dr 23.6'))).toHaveLength(1);

  // The VAT month: base and VAT in the 18% boxes moved by exactly this sale.
  const after = (await api.get(`/api/vat/${thisMonth()}`)).boxes as Record<number, number>;
  expect(Math.round((after[12]! - (before[12] ?? 0)) * 100)).toBe(2000);
  expect(Math.round((after[13]! - (before[13] ?? 0)) * 100)).toBe(360);
  await api.dispose();
});
