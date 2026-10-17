/**
 * What money goes on: the plain categories a cost line on a bill (or an
 * expense paid on the spot) can have. Stock bought to resell is deliberately
 * not here: its cost already counts in profit when it sells, so adding it
 * again would count it twice. Each one books to its own expense account
 * (`expense:<category>` in the books' links).
 */
export const EXPENSE_CATEGORIES = [
  'rent',
  'electricity',
  'water',
  'internet',
  'fuel',
  'transport',
  'repairs',
  'cleaning',
  'advertising',
  'bank_fees',
  'professional',
  'insurance',
  'office',
  'supplies',
  'wages',
  'taxes',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Which part of 4VD SH.P.K an expense belongs to. */
export const EXPENSE_PLACES = ['shop', 'carwash', 'both'] as const;
export type ExpensePlace = (typeof EXPENSE_PLACES)[number];
