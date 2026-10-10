import { describe, expect, it } from 'vitest';
import type { DayStep, ShopDay } from '../services/types';
import { carwashLabel, shiftSteps } from './shift';

describe('shiftSteps', () => {
  const day = (steps: DayStep[]): ShopDay => ({ day: '2026-10-10', today: '2026-10-10', steps, done: 0, total: steps.length, allDone: false });
  const steps: DayStep[] = [
    { kind: 'drawer', key: 'shop', place: 'shop', carwashId: null, name: null, done: true, countedBy: 'Arta' },
    { kind: 'drawer', key: 'carwash:2', place: 'carwash', carwashId: 2, name: 'Fushë', done: false, countedBy: null },
    { kind: 'carwash', key: 'takings:2', carwashId: 2, name: 'Fushë', done: false },
    { kind: 'expenses', key: 'expenses', done: false, count: 0, total: 0, noneMarked: false, noneMarkedBy: null },
  ];

  it("keeps the counter steps in the server's order and points at the first not done", () => {
    const shift = shiftSteps(day(steps));
    expect(shift.steps.map((step) => step.key)).toEqual(['shop', 'carwash:2', 'takings:2']);
    expect(shift.done).toBe(1);
    expect(shift.total).toBe(3);
    expect(shift.next?.key).toBe('carwash:2');
  });

  it('has nothing next once everything is in', () => {
    const shift = shiftSteps(day(steps.map((step) => ({ ...step, done: true }))));
    expect(shift.done).toBe(3);
    expect(shift.next).toBeUndefined();
  });

  it('is empty while nothing has loaded', () => {
    expect(shiftSteps(undefined)).toEqual({ steps: [], done: 0, total: 0, next: undefined });
  });
});

describe('carwashLabel', () => {
  it('names the carwash only when there are several', () => {
    expect(carwashLabel('Carwash', 'Fushë', false)).toBe('Carwash');
    expect(carwashLabel('Carwash', 'Fushë', true)).toBe('Carwash (Fushë)');
  });

  it("doesn't repeat the word when the name already has it", () => {
    expect(carwashLabel('Carwash', 'Carwash Prishtina', true)).toBe('Carwash Prishtina');
    expect(carwashLabel('Carwash', 'Carwash', true)).toBe('Carwash');
  });
});
