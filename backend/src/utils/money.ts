const euroFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

export const formatEuro = (amount: number) => euroFormatter.format(amount);

/**
 * To whole cents, halves away from zero (1.005 → 1.01, -1.005 → -1.01), as on a
 * receipt. The cents are first cut to 12 significant digits, so float noise
 * (1.005 * 100 = 100.49999…) can't turn a half cent into a round-down, and a
 * refund rounds exactly like the sale it mirrors.
 */
export const roundMoney = (amount: number) => {
  const cents = Number((Math.abs(amount) * 100).toPrecision(12));
  return (Math.sign(amount) * Math.round(cents)) / 100 || 0;
};
