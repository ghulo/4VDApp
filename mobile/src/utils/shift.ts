import type { DayStep, ShopDay } from '../services/types';

/** A step closed at the counter: count a drawer, or enter a carwash's takings. */
export type ShiftStep = Extract<DayStep, { kind: 'drawer' | 'carwash' }>;

/** Under ['cash'], so counting a drawer or entering takings ticks its step off. */
export const DAY_QUERY_KEY = ['cash', 'day'] as const;

/** From this hour Home suggests ending the shift. */
export const CLOSING_HOUR = 18;

const atTheCounter = (step: DayStep): step is ShiftStep => step.kind === 'drawer' || step.kind === 'carwash';

/**
 * What ending the shift takes, from the server's close-the-day steps (the
 * dashboard's Day page reads the same list). Expenses and requests are done
 * on the dashboard, so the shift covers the drawers and the carwash takings.
 */
export function shiftSteps(day: ShopDay | undefined): { steps: ShiftStep[]; done: number; total: number; next: ShiftStep | undefined } {
  const steps = (day?.steps ?? []).filter(atTheCounter);
  const done = steps.filter((step) => step.done).length;
  return { steps, done, total: steps.length, next: steps.find((step) => !step.done) };
}

/** "Carwash (Fushë)" when there are several; just the name when it already says "Carwash". */
export function carwashLabel(word: string, name: string | null, several: boolean): string {
  if (!several || !name) return word;
  return name.toLowerCase().includes(word.toLowerCase()) ? name : `${word} (${name})`;
}
