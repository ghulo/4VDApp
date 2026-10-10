import { describe, expect, it } from 'vitest';
import { carwashLabel, shiftSteps } from './shift';

describe('shiftSteps', () => {
  const drawers = [
    { place: 'shop' as const, carwashId: null, name: null, countedAt: '2026-10-10T17:00:00Z' },
    { place: 'carwash' as const, carwashId: 2, name: 'Fushë', countedAt: null },
  ];
  const carwashes = [{ id: 2, name: 'Fushë', takings: null }];

  it('lists every drawer, then each carwash, and points at the first not done', () => {
    const shift = shiftSteps(drawers, carwashes);
    expect(shift.steps.map((step) => step.key)).toEqual(['shop', 'carwash:2', 'takings:2']);
    expect(shift.done).toBe(1);
    expect(shift.total).toBe(3);
    expect(shift.next?.key).toBe('carwash:2');
  });

  it('has nothing next once everything is in', () => {
    const shift = shiftSteps(
      drawers.map((drawer) => ({ ...drawer, countedAt: '2026-10-10T17:00:00Z' })),
      [{ id: 2, name: 'Fushë', takings: { carwash: 10 } }],
    );
    expect(shift.done).toBe(3);
    expect(shift.next).toBeUndefined();
  });

  it('is empty while nothing has loaded', () => {
    expect(shiftSteps(undefined, undefined)).toEqual({ steps: [], done: 0, total: 0, next: undefined });
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
