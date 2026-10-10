/** One thing to do before going home: count a drawer, or enter a carwash's takings. */
export type ShiftStep =
  | { kind: 'drawer'; key: string; place: 'shop' | 'carwash'; name: string | null; done: boolean }
  | { kind: 'carwash'; key: string; carwashId: number; name: string; done: boolean };

/** From this hour Home suggests ending the shift. */
export const CLOSING_HOUR = 18;

/**
 * What ending the shift takes: every drawer counted (the shop, then each
 * carwash), then each carwash's takings entered. Worked out from what the
 * team app already loads, so Home and End shift always agree.
 */
export function shiftSteps(
  drawers: Array<{ place: 'shop' | 'carwash'; carwashId: number | null; name: string | null; countedAt: string | null }> | undefined,
  carwashes: Array<{ id: number; name: string; takings: unknown }> | undefined,
): { steps: ShiftStep[]; done: number; total: number; next: ShiftStep | undefined } {
  const steps: ShiftStep[] = [
    ...(drawers ?? []).map((drawer) => ({
      kind: 'drawer' as const,
      key: drawer.place === 'shop' ? 'shop' : `carwash:${drawer.carwashId}`,
      place: drawer.place,
      name: drawer.name,
      done: drawer.countedAt !== null,
    })),
    ...(carwashes ?? []).map((carwash) => ({
      kind: 'carwash' as const,
      key: `takings:${carwash.id}`,
      carwashId: carwash.id,
      name: carwash.name,
      done: Boolean(carwash.takings),
    })),
  ];
  const done = steps.filter((step) => step.done).length;
  return { steps, done, total: steps.length, next: steps.find((step) => !step.done) };
}

/** "Carwash (Fushë)" when there are several; just the name when it already says "Carwash". */
export function carwashLabel(word: string, name: string | null, several: boolean): string {
  if (!several || !name) return word;
  return name.toLowerCase().includes(word.toLowerCase()) ? name : `${word} (${name})`;
}
