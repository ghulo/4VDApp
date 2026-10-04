/**
 * What money goes on. Stock bought to resell is deliberately not here: its
 * cost already counts in profit when it sells, so adding it again would count
 * it twice.
 */
export const EXPENSE_CATEGORIES = ['rent', 'electricity', 'water', 'wages', 'supplies', 'repairs', 'taxes', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Which part of 4VD SH.P.K an expense belongs to. */
export const EXPENSE_PLACES = ['shop', 'carwash', 'both'] as const;
export type ExpensePlace = (typeof EXPENSE_PLACES)[number];
