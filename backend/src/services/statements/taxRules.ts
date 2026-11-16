import type { LegalForm } from '../../database/types.js';
import { roundMoney } from '../../utils/money.js';
import { PAYROLL_RULES, rulesFor } from '../payroll/payrollRules.js';

/**
 * Which yearly declaration a business files, and the tax on its profit.
 *
 * - A company (sh.p.k., sh.a.) files the CD and pays 10% corporate income tax
 *   (Law 06/L-105).
 * - An individual business (B.I.) files the PD and pays personal income tax on
 *   the yearly bands.
 *
 * DEFAULT (accountant to confirm, handoff.md): the PD bands are the monthly
 * wage tax bands times 12 (Law 05/L-028 as amended by 08/L-142): 0% up to
 * €3,000, 8% up to €5,400, 10% above. Only businesses taxed on their real
 * profit are covered, not the 3% / 9% turnover scheme for those under €30,000.
 */
export type DeclarationForm = 'CD' | 'PD';
export const formOf = (legalForm: LegalForm): DeclarationForm => (legalForm === 'individual' ? 'PD' : 'CD');

export const CORPORATE_RATE = 10;

export interface TaxBand {
  /** The rate applies above this much of the year's profit, up to the next band. */
  over: number;
  rate: number;
}

/** The PD's yearly bands for a year: the monthly wage tax bands in force in December, times 12. */
export function personalBands(year: number): TaxBand[] {
  const rules = rulesFor(`${year}-12-01`) ?? PAYROLL_RULES[0]!;
  return rules.bands.map((band) => ({ over: roundMoney(band.over * 12), rate: band.rate }));
}

export interface TaxPart {
  from: number;
  to: number | null;
  rate: number;
  base: number;
  tax: number;
}

/** The tax on a year's taxable profit, part by part (one part for the CD's flat 10%). */
export function taxParts(form: DeclarationForm, taxable: number, year: number): TaxPart[] {
  const profit = Math.max(0, taxable);
  const bands: TaxBand[] = form === 'CD' ? [{ over: 0, rate: CORPORATE_RATE }] : personalBands(year);
  return bands.map((band, index) => {
    const top = bands[index + 1]?.over ?? null;
    const base = roundMoney(Math.max(0, Math.min(profit, top ?? Infinity) - band.over));
    return { from: band.over, to: top, rate: band.rate, base, tax: roundMoney((base * band.rate) / 100) };
  });
}

export function incomeTax(form: DeclarationForm, taxable: number, year: number): number {
  return roundMoney(taxParts(form, taxable, year).reduce((sum, part) => sum + part.tax, 0));
}
