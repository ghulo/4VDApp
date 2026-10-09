import { describe, expect, it } from 'vitest';
import { dayAfter, parseTypedDay, toTypedDay } from './expiryDay';

describe('expiryDay', () => {
  it('should read a day-first date', () => expect(parseTypedDay('12.10.2026')).toBe('2026-10-12'));
  it('should pad single digits', () => expect(parseTypedDay('1.2.2027')).toBe('2027-02-01'));
  it('should accept slashes and dashes', () => {
    expect(parseTypedDay('12/10/2026')).toBe('2026-10-12');
    expect(parseTypedDay('12-10-2026')).toBe('2026-10-12');
  });
  it('should reject days that do not exist', () => {
    expect(parseTypedDay('31.02.2026')).toBeNull();
    expect(parseTypedDay('00.10.2026')).toBeNull();
    expect(parseTypedDay('12.13.2026')).toBeNull();
  });
  it('should reject anything else', () => {
    expect(parseTypedDay('')).toBeNull();
    expect(parseTypedDay('12.10.26')).toBeNull();
    expect(parseTypedDay('2026-10-12')).toBeNull();
  });
  it('should write a day the way it is typed', () => expect(toTypedDay('2026-10-12')).toBe('12.10.2026'));
  it('should count days across a month end', () => expect(dayAfter(new Date(2026, 9, 30), 3)).toBe('2026-11-02'));
});
