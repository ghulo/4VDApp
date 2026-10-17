import { roundMoney } from '../../utils/money.js';

/**
 * Kosovo's VAT rates in percent: standard, the old standard rate 16% (still on
 * some suppliers' papers), reduced and zero. "Exempt" is a 0% rate marked
 * `vatExempt`; it only changes which box of the VAT return it goes in.
 */
export const VAT_RATES = [18, 16, 8, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];
export const DEFAULT_VAT_RATE: VatRate = 18;

/**
 * Split a VAT-inclusive amount into net and VAT. The VAT is what is left after
 * rounding the net, so the two always add up to the amount exactly.
 */
export function splitVat(total: number, rate: number): { net: number; vat: number } {
  const net = roundMoney((total * 100) / (100 + rate));
  return { net, vat: roundMoney(total - net) };
}
