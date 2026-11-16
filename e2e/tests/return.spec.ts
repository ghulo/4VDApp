import { expect, test } from '@playwright/test';
import { apiAs, productBySku, balances, thisMonth } from './api';

test.use({ storageState: '.auth/admin.json' });

const cents = (amount: number | undefined) => Math.round((amount ?? 0) * 100);

test('a return at the Counter refunds the money, puts stock back, and reverses the books and VAT', async ({ page }) => {
  const api = await apiAs('admin');
  const product = await productBySku(api, 'E2E-BUKE');
  // Three loaves at €1.08 with 8% VAT inside, sold at the Counter.
  const sold = await api.post('/api/sales/basket', {
    items: [{ productId: product.id, quantity: 3 }],
  });
  const number: string = sold.invoice?.number ?? sold.document?.number ?? sold.number;
  expect(number).toBeTruthy();

  const stockBefore = (await productBySku(api, 'E2E-BUKE')).stock.quantity;
  const booksBefore = await balances(api, '2000-01-01');
  const vatBefore = (await api.get(`/api/vat/${thisMonth()}`)).boxes as Record<number, number>;

  await page.goto('/counter');
  await expect(page.getByRole('button', { name: 'Switch person' })).toBeVisible();
  await page.keyboard.press('F7');
  await page.getByRole('textbox', { name: 'Invoice number' }).fill(number);
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByRole('spinbutton', { name: 'How many E2E Bukë come back' }).fill('1');
  await page.getByRole('radio', { name: 'Back on the shelf' }).click();
  await page.getByRole('button', { name: 'Refund €1.08' }).click();
  await expect(page.getByText('Refund recorded. Give back €1.08.')).toBeVisible();

  expect((await api.get(`/api/products/${product.id}`)).stock.quantity).toBe(stockBefore + 1);

  // The books moved by exactly one loaf back: €1.00 returns, €0.08 VAT, €0.50 cost back into stock, €1.08 cash out.
  const booksAfter = await balances(api, '2000-01-01');
  const moved = (account: string) => cents(booksAfter[account]) - cents(booksBefore[account]);
  expect(moved('4200')).toBe(100);
  expect(moved('2340')).toBe(8);
  expect(moved('1340')).toBe(50);
  expect(moved('5000')).toBe(-50);
  const cashMoved = Object.keys({ ...booksBefore, ...booksAfter })
    .filter((account) => account.startsWith('11'))
    .reduce((sum, account) => sum + moved(account), 0);
  expect(cashMoved).toBe(-108);
  // Every entry balances: the whole trial balance still sums to zero.
  expect(Object.values(booksAfter).reduce((sum, amount) => sum + cents(amount), 0)).toBe(0);

  const vatAfter = (await api.get(`/api/vat/${thisMonth()}`)).boxes as Record<number, number>;
  expect(cents(vatAfter[55]) - cents(vatBefore[55])).toBe(100);
  expect(cents(vatAfter[56]) - cents(vatBefore[56])).toBe(8);
  await api.dispose();
});
