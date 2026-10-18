/** Euro notes and coins in cents, biggest first (no €500 or €200 in a shop drawer). */
const DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

/** The change to give back as the fewest notes and coins: [[value in euros, count], …]. */
export function changeIn(amount: number): Array<{ value: number; count: number }> {
  let cents = Math.round(amount * 100);
  const pieces: Array<{ value: number; count: number }> = [];
  for (const unit of DENOMINATIONS) {
    const count = Math.floor(cents / unit);
    if (count > 0) {
      pieces.push({ value: unit / 100, count });
      cents -= count * unit;
    }
  }
  return pieces;
}

/** What a customer is likely to hand over for this total: the total rounded up to the next 1, 5, 10, 20, 50 and 100. */
export function likelyNotes(total: number): number[] {
  const amounts = [1, 5, 10, 20, 50, 100].map((step) => Math.ceil(total / step) * step).filter((amount) => amount > total);
  return [...new Set(amounts)].slice(0, 4);
}
