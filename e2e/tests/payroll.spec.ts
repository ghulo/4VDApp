import { expect, test } from '@playwright/test';
import { apiAs, balances, lastMonth } from './api';

test.use({ storageState: '.auth/owner.json' });

const cents = (amount: number | undefined) => Math.round((amount ?? 0) * 100);

test('confirming a payroll month posts wages, pension and tax owed to the books', async ({ page }) => {
  const api = await apiAs('owner');
  const before = await balances(api, '2000-01-01');

  await page.goto('/payroll/months');
  const month = new Date(`${lastMonth()}-15T12:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  await page.getByRole('combobox', { name: 'Month' }).selectOption({ label: month });
  // €500 gross: €25 pension each side, €18.50 wage tax (0% to €250, 8% to €450, 10% above), €456.50 net.
  const row = page.getByRole('table', { name: `Pay for ${month}` }).getByRole('row', { name: /Arta Krasniqi/ });
  await expect(row).toContainText('€500.00');
  await expect(row).toContainText('€18.50');
  await expect(row).toContainText('€456.50');
  await expect(page.getByText('Costs the business €525.00')).toBeVisible();
  await page.getByRole('button', { name: `Confirm ${month}` }).click();
  await expect(page.getByRole('region', { name: 'Earlier months' })).toContainText(month);

  const after = await balances(api, '2000-01-01');
  const moved = (account: string) => cents(after[account]) - cents(before[account]);
  expect(moved('6500')).toBe(50000);
  expect(moved('6520')).toBe(2500);
  expect(moved('2200')).toBe(-2500);
  expect(moved('2210')).toBe(-2500);
  expect(moved('2310')).toBe(-1850);
  expect(moved('2100')).toBe(-45650);
  expect(Object.values(after).reduce((sum, amount) => sum + cents(amount), 0)).toBe(0);
  await api.dispose();
});
