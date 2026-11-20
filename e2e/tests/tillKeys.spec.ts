import { expect, test } from '@playwright/test';

test.use({ storageState: '.auth/admin.json' });

test('the till: no shelf reload after a sale, Pay from the keyboard, a payment kept on Back, a reason picked then confirmed', async ({ page }) => {
  await page.goto('/counter');
  const scan = page.getByRole('textbox', { name: 'Scan or type a product' });
  const table = page.getByRole('table', { name: 'Lines in this basket' });
  await scan.fill('E2E-KAFE');
  await scan.press('Enter');
  await expect(table.getByRole('cell', { name: '€11.80' }).first()).toBeVisible();

  // Pay: F3 picks cash + card; the card part typed, then Esc back to the basket keeps it.
  await page.keyboard.press('F9');
  const pay = page.getByRole('form', { name: 'Pay €11.80' });
  await page.keyboard.press('F3');
  const cardPart = pay.getByRole('textbox', { name: /On the card/ });
  await expect(cardPart).toBeFocused();
  await cardPart.fill('5');
  await page.keyboard.press('Escape');
  await expect(pay).toBeHidden();
  await page.keyboard.press('F9');
  await expect(pay.getByRole('radio', { name: /Cash \+ card/ })).toHaveAttribute('aria-checked', 'true');
  await expect(pay.getByRole('textbox', { name: /On the card/ })).toHaveValue('5');

  // F2: card; the focus is on Record sale, so Enter records. The shelf is not fetched again; the day figures are.
  const shelfFetches: string[] = [];
  const todayFetches: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    if (request.url().includes('/api/counter/shelf')) shelfFetches.push(request.url());
    if (request.url().includes('/api/counter/today')) todayFetches.push(request.url());
  });
  await page.keyboard.press('F2');
  await expect(pay.getByRole('button', { name: 'Record sale · €11.80' })).toBeFocused();
  await page.keyboard.press('Enter');
  const receipt = page.locator('details.counter-card').filter({ hasText: 'Last sale' });
  await expect(receipt).toContainText('€11.80');
  await expect.poll(() => todayFetches.length).toBeGreaterThan(0);
  expect(shelfFetches).toEqual([]);

  // Taking a line off: a reason picked with its number only shows as chosen; Enter takes the line off.
  await scan.fill('E2E-KAFE');
  await scan.press('Enter');
  await expect(table.getByRole('cell', { name: '€11.80' }).first()).toBeVisible();
  await scan.focus();
  await page.keyboard.press('Delete');
  const first = page.getByRole('radio').first();
  await expect(first).toBeVisible();
  await page.keyboard.press('1');
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await expect(table).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(table.getByRole('cell', { name: '€11.80' })).toHaveCount(0);
});
