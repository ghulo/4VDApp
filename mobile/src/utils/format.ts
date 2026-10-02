const moneyFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

export const formatMoney = (amount: number) => moneyFormatter.format(amount);

const dayMonthFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** "−15% until 7 Oct". Promotions end at the start of the day after their last day. */
export function promotionLabel(promotion: { percentOff: number; endsAt: string }): string {
  const lastDay = new Date(new Date(promotion.endsAt).getTime() - 1);
  return `−${promotion.percentOff}% until ${dayMonthFormatter.format(lastDay)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
