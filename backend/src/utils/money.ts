const euroFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

export const formatEuro = (amount: number) => euroFormatter.format(amount);

/** Avoid 0.1 + 0.2 style float noise in money sums. */
export const roundMoney = (amount: number) => Math.round(amount * 100) / 100;
