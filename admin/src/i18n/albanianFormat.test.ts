import { describe, expect, it } from 'vitest';
import { albanianDate as date, albanianMoney as money, albanianNumber as number } from './albanianFormat';

/** The output uses non-breaking spaces so amounts never wrap; compare them as plain spaces. */
const plain = (text: string) => text.replace(new RegExp(String.fromCharCode(160), 'g'), ' ');
const albanianMoney = (amount: number) => plain(money(amount));
const albanianNumber = (value: number, digits: number) => plain(number(value, digits));
const albanianDate = (value: Date, options: Intl.DateTimeFormatOptions) => plain(date(value, options));

const october7 = new Date(Date.UTC(2026, 9, 7, 14, 5));

describe('albanianMoney', () => {
  it('should put the euro after the amount with a decimal comma', () => expect(albanianMoney(70)).toBe('70,00 €'));
  it('should leave four-digit amounts ungrouped', () => expect(albanianMoney(1204.5)).toBe('1204,50 €'));
  it('should group five digits and up with spaces', () => expect(albanianMoney(245829)).toBe('245 829,00 €'));
  it('should keep the minus sign', () => expect(albanianMoney(-12.5)).toBe('-12,50 €'));
});

describe('albanianNumber', () => {
  it('should write a percentage with a decimal comma', () => expect(albanianNumber(12.5, 1)).toBe('12,5'));
});

describe('albanianDate', () => {
  const utc = { timeZone: 'UTC' } as const;
  it('should write day and short month', () =>
    expect(albanianDate(october7, { day: 'numeric', month: 'short', ...utc })).toBe('7 tet'));
  it('should add the year', () =>
    expect(albanianDate(october7, { day: 'numeric', month: 'short', year: 'numeric', ...utc })).toBe('7 tet 2026'));
  it('should write a long month and year', () =>
    expect(albanianDate(october7, { month: 'long', year: 'numeric', ...utc })).toBe('tetor 2026'));
  it('should write the weekday', () => expect(albanianDate(october7, { weekday: 'long', ...utc })).toBe('e mërkurë'));
  it('should write weekday, day and long month', () =>
    expect(albanianDate(october7, { weekday: 'long', day: 'numeric', month: 'long', ...utc })).toBe('e mërkurë, 7 tetor'));
  it('should write the time', () => expect(albanianDate(october7, { hour: '2-digit', minute: '2-digit', ...utc })).toBe('14:05'));
  it('should write day, month and time', () =>
    expect(albanianDate(october7, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...utc })).toBe(
      '7 tet, 14:05',
    ));
});
