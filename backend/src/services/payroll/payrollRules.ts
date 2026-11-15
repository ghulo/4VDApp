import { roundMoney } from '../../utils/money.js';

/**
 * Kosovo's wage rules, by the month they start. A month uses the last set that
 * started on or before it. Change or add a set here when the law changes;
 * months already confirmed keep the figures they were worked out with.
 *
 * Sources (checked 2026-11-15):
 * - Wage tax bands per month: 0% up to €250, 8% from €250.01 to €450, 10% above.
 *   Law No. 05/L-028 on Personal Income Tax, as amended by Law No. 08/L-142,
 *   applied by ATK from 23 August 2024 (EY Kosovo news release, "Changes in the
 *   minimum gross salary and personal income tax rates"; PwC Tax Summaries,
 *   Kosovo, "Taxes on personal income": €3,000 / €5,400 a year). The first
 *   whole month under them is September 2024, so that is where this set starts.
 * - Second job: the whole taxable pay at a flat 10%, no tax-free part
 *   (Payoneer and Eurofast payroll guides; not seen in the law's text).
 *   Accountant question in handoff.md.
 * - Minimum wage: €350 a month gross for full-time work from 1 October 2024
 *   (same EY release; Law 08/L-142). Only a warning in 4VD, never a block.
 * - Trust pension (Kosovo Pension Savings Trust, Law No. 04/L-101 on Pension
 *   Funds): 5% from the employee, held back from gross pay, and 5% from the
 *   employer on top (PwC Tax Summaries, Kosovo, "Other taxes"). Each side may
 *   add more of its own choosing; sources disagree on the cap (IMF: 15% in all;
 *   PwC: 15% + 15%; Payoneer: up to 15% each side). 4VD allows each side up to
 *   15% in all. Accountant question in handoff.md.
 * - Taxable pay is gross less the employee's pension share (the employee's
 *   voluntary extra too), as TREFIN's monthly payroll shows ("Paga e
 *   tatueshme"). Accountant question in handoff.md.
 * - Declared and paid by the 15th of the next month (PwC Tax Summaries,
 *   Kosovo, "Tax administration").
 */
export interface PayrollRules {
  from: string;
  /** Monthly bands on taxable pay: the rate applies above `over` (up to the next band). */
  bands: Array<{ over: number; rate: number }>;
  secondaryRate: number;
  employeePension: number;
  employerPension: number;
  /** The most either side may pay in all, mandatory plus voluntary. */
  maxPensionEachSide: number;
  minimumWage: number;
  /** Day of the next month the tax and pension are declared and paid by. */
  dueDay: number;
}

export const PAYROLL_RULES: PayrollRules[] = [
  {
    from: '2024-09-01',
    bands: [
      { over: 0, rate: 0 },
      { over: 250, rate: 8 },
      { over: 450, rate: 10 },
    ],
    secondaryRate: 10,
    employeePension: 5,
    employerPension: 5,
    maxPensionEachSide: 15,
    minimumWage: 350,
    dueDay: 15,
  },
];

/** The rules for a month ("2026-09-01"), or null before 4VD knows any. */
export function rulesFor(month: string): PayrollRules | null {
  let found: PayrollRules | null = null;
  for (const rules of PAYROLL_RULES) if (rules.from <= month) found = rules;
  return found;
}

export interface PayInput {
  gross: number;
  secondary: boolean;
  /** No Trust pension at all (a person not resident in Kosovo). */
  nonResident: boolean;
  /** Voluntary extra percent on top of the 5%, each side. */
  extraEmployee: number;
  extraEmployer: number;
}

export interface TaxPart {
  /** The slice of taxable pay this rate is on. */
  base: number;
  rate: number;
  tax: number;
}

export interface PayResult {
  gross: number;
  employeeRate: number;
  employerRate: number;
  employeePension: number;
  employerPension: number;
  taxable: number;
  /** How the tax was worked out, one slice per band (a second job: one flat slice). */
  taxParts: TaxPart[];
  tax: number;
  net: number;
  /** What the business pays in all: gross plus its own pension share. */
  cost: number;
}

const pct = (amount: number, rate: number) => roundMoney((amount * rate) / 100);

/** Gross to net: the pension shares, the taxable pay, the tax band by band, and what is left. */
export function payFromGross(input: PayInput, rules: PayrollRules): PayResult {
  const gross = roundMoney(input.gross);
  const employeeRate = input.nonResident ? 0 : Math.min(rules.maxPensionEachSide, rules.employeePension + input.extraEmployee);
  const employerRate = input.nonResident ? 0 : Math.min(rules.maxPensionEachSide, rules.employerPension + input.extraEmployer);
  const employeePension = pct(gross, employeeRate);
  const employerPension = pct(gross, employerRate);
  const taxable = roundMoney(Math.max(0, gross - employeePension));
  const taxParts: TaxPart[] = [];
  if (input.secondary) {
    taxParts.push({ base: taxable, rate: rules.secondaryRate, tax: pct(taxable, rules.secondaryRate) });
  } else {
    rules.bands.forEach((band, index) => {
      const top = rules.bands[index + 1]?.over ?? Infinity;
      const base = roundMoney(Math.max(0, Math.min(taxable, top) - band.over));
      if (base > 0) taxParts.push({ base, rate: band.rate, tax: pct(base, band.rate) });
    });
  }
  const tax = roundMoney(taxParts.reduce((sum, part) => sum + part.tax, 0));
  const net = roundMoney(gross - employeePension - tax);
  return { gross, employeeRate, employerRate, employeePension, employerPension, taxable, taxParts, tax, net, cost: roundMoney(gross + employerPension) };
}

/**
 * Net to gross: the gross whose net is exactly the agreed net. Rounding each
 * part to the cent can make one net cent unreachable; then it is the lowest
 * gross whose net is a cent above, never below what was agreed.
 */
export function grossFromNet(net: number, input: Omit<PayInput, 'gross'>, rules: PayrollRules): number {
  const target = roundMoney(net);
  if (target <= 0) return 0;
  const netOf = (gross: number) => payFromGross({ ...input, gross }, rules).net;
  // Net only grows with gross, so halve the gap in whole cents.
  let low = 0;
  let high = Math.round(target * 100 * 2) + 100;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (netOf(mid / 100) >= target) high = mid;
    else low = mid + 1;
  }
  return low / 100;
}

/** The day ("2026-10-15") a month's tax and pension are due. */
export function dueDayOf(month: string, rules: PayrollRules): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const next = mon === 12 ? { y: year + 1, m: 1 } : { y: year, m: mon + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-${String(rules.dueDay).padStart(2, '0')}`;
}
