const moneyFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

export const formatMoney = (amount: number) => moneyFormatter.format(amount);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
