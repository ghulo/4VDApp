import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EntryBuilder, vatOf, type AccountLinks } from '../../src/services/books/entryBuilder.js';
import { grossFromNet, payFromGross, PAYROLL_RULES, type PayInput } from '../../src/services/payroll/payrollRules.js';
import {
  asSupplierCredit,
  chargedVat,
  claimedVat,
  localPurchaseBoxes,
  saleBoxes,
  vatResult,
  type Boxes,
  type VatItem,
} from '../../src/services/vat/vatReturn.js';
import { roundMoney } from '../../src/utils/money.js';

/**
 * Generated-input checks on the money maths: VAT split, VAT return boxes,
 * books entries and payroll. Pure functions only, no database, so these run
 * in a second or two and never touch the shared test database.
 */

const RUNS = { numRuns: 500 };
/** Amounts are drawn as whole cents, so every input is a real price. */
const euros = (maxCents = 10_000_000) => fc.integer({ min: 1, max: maxCents }).map((cents) => cents / 100);
const cents = (amount: number) => Math.round(amount * 100);
const vatRate = fc.constantFrom(0, 8, 16, 18);
const rules = PAYROLL_RULES[PAYROLL_RULES.length - 1]!;

describe('roundMoney', () => {
  it('lands on whole cents and moves an amount by at most half a cent', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e7, max: 1e7, noNaN: true }), (amount) => {
        const rounded = roundMoney(amount);
        expect(Number.isInteger(Math.round(rounded * 100))).toBe(true);
        expect(Math.abs(rounded - amount)).toBeLessThanOrEqual(0.005 + 1e-9);
      }),
      RUNS,
    );
  });

  it('leaves an amount already in cents unchanged', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), (c) => {
        expect(roundMoney(c / 100)).toBe(c / 100);
      }),
      RUNS,
    );
  });
});

describe('VAT on a VAT-inclusive price', () => {
  it('net plus VAT is the price to the cent, and the VAT is never more than the price', () => {
    fc.assert(
      fc.property(euros(), vatRate, (gross, rate) => {
        const vat = vatOf(gross, rate);
        const net = roundMoney(gross - vat);
        expect(cents(net) + cents(vat)).toBe(cents(gross));
        expect(vat).toBeGreaterThanOrEqual(0);
        expect(vat).toBeLessThanOrEqual(gross);
        if (rate === 0) expect(vat).toBe(0);
      }),
      RUNS,
    );
  });

  it('is within a cent of the exact VAT', () => {
    fc.assert(
      fc.property(euros(), fc.constantFrom(8, 16, 18), (gross, rate) => {
        const exact = (gross * rate) / (100 + rate);
        expect(Math.abs(vatOf(gross, rate) - exact)).toBeLessThanOrEqual(0.005 + 1e-9);
      }),
      RUNS,
    );
  });
});

describe('VAT return boxes', () => {
  const saleItem = (boxes: Boxes): VatItem => ({
    kind: 'invoice',
    ref: '1',
    date: '2026-10-01',
    number: null,
    party: null,
    nui: null,
    boxes,
  });

  it("a sale's boxes add back up to its price, and a full return lowers the VAT by exactly what the sale charged", () => {
    fc.assert(
      fc.property(euros(), vatRate, fc.boolean(), (gross, rate, exempt) => {
        const sale: Boxes = {};
        saleBoxes(sale, gross, rate, exempt, 1);
        const total = Object.values(sale).reduce<number>((sum, amount) => sum + cents(amount ?? 0), 0);
        expect(total).toBe(cents(gross));

        const back: Boxes = {};
        saleBoxes(back, gross, rate, exempt, -1);
        const backTotal = Object.values(back).reduce<number>((sum, amount) => sum + cents(amount ?? 0), 0);
        // Exempt and 0% returns lower boxes 9/10 (negative); taxed returns go in the credit-note boxes 53-56.
        expect(Math.abs(backTotal)).toBe(cents(gross));
        const returnedVat = cents((back[54] ?? 0) + (back[56] ?? 0));
        expect(returnedVat).toBe(cents(chargedVat(saleItem(sale))));
      }),
      RUNS,
    );
  });

  it('a supplier credit turns claimed VAT into credit-note VAT of the same amount', () => {
    fc.assert(
      fc.property(euros(), fc.constantFrom(0, 8, 18), fc.boolean(), (net, rate, equipment) => {
        const vat = roundMoney((net * rate) / 100);
        const bill: Boxes = {};
        localPurchaseBoxes(bill, net, vat, rate, equipment);
        const credit = asSupplierCredit(bill);
        expect(cents((credit[17] ?? 0) + (credit[19] ?? 0))).toBe(cents(claimedVat(saleItem(bill))));
      }),
      RUNS,
    );
  });

  it("the return's totals add up: pay (72) or carry (71), never both, and refund never above the credit", () => {
    const item = fc
      .record({
        gross: euros(1_000_000),
        rate: vatRate,
        buy: fc.boolean(),
        refund: fc.boolean(),
      })
      .map(({ gross, rate, buy, refund }): VatItem => {
        const boxes: Boxes = {};
        if (buy) localPurchaseBoxes(boxes, gross, roundMoney((gross * rate) / 100), rate, false);
        else saleBoxes(boxes, gross, rate, false, refund ? -1 : 1);
        return saleItem(boxes);
      });
    fc.assert(
      fc.property(fc.array(item, { maxLength: 30 }), euros(1_000_000), euros(1_000_000), (items, carriedIn, refundAsked) => {
        const { boxes, outcome } = vatResult(items, carriedIn, refundAsked);
        const charged = items.reduce((sum, i) => sum + cents(chargedVat(i)), 0);
        const claimed = items.reduce((sum, i) => sum + cents(claimedVat(i)), 0);
        expect(cents(boxes[30]!)).toBe(charged);
        expect(cents(boxes[67]!)).toBe(claimed);
        // Box 72 (to pay) minus box 69 (credit) is exactly what is charged minus what is claimed and carried in.
        expect(cents(boxes[72]!) - cents(boxes[69]!)).toBe(charged - claimed - cents(carriedIn));
        expect(boxes[72]! > 0 && boxes[69]! > 0).toBe(false);
        expect(boxes[70]!).toBeLessThanOrEqual(boxes[69]!);
        expect(cents(boxes[70]!) + cents(boxes[71]!)).toBe(cents(boxes[69]!));
        expect(outcome).toBe(boxes[72]! > 0 ? 'pay' : boxes[71]! > 0 ? 'carry' : 'nothing');
      }),
      RUNS,
    );
  });
});

describe('Books entries', () => {
  const links = {
    cash: 1,
    sales: 2,
    vatOwed: 3,
    stock: 4,
    costOfSales: 5,
    payables: 6,
  } as unknown as AccountLinks;
  const accounts = fc.constantFrom(...Object.keys(links));

  it('a sale split into net and VAT always balances to the cent', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(euros(1_000_000), vatRate), {
          minLength: 1,
          maxLength: 40,
        }),
        (lines) => {
          const builder = new EntryBuilder(links);
          for (const [gross, rate] of lines) {
            const vat = vatOf(gross, rate);
            builder
              .debit('cash' as never, gross)
              .credit('sales' as never, gross - vat)
              .credit('vatOwed' as never, vat);
          }
          const entry = builder.build('2026-10-01', 'sale');
          expect(entry).not.toBeNull();
          const debits = entry!.lines.reduce((sum, line) => sum + cents(line.debit), 0);
          const credits = entry!.lines.reduce((sum, line) => sum + cents(line.credit), 0);
          expect(debits).toBe(credits);
          expect(debits).toBe(lines.reduce((sum, [gross]) => sum + cents(gross), 0));
        },
      ),
      RUNS,
    );
  });

  it('any set of moves that balances builds an entry with equal debits and credits, one line per account, none both sides', () => {
    const move = fc.tuple(accounts, accounts, euros(1_000_000));
    fc.assert(
      fc.property(fc.array(move, { minLength: 1, maxLength: 40 }), (moves) => {
        const builder = new EntryBuilder(links);
        for (const [from, to, amount] of moves) builder.debit(to as never, amount).credit(from as never, amount);
        const entry = builder.build('2026-10-01', 'moves');
        if (entry === null) return; // every move cancelled out
        const debits = entry.lines.reduce((sum, line) => sum + cents(line.debit), 0);
        const credits = entry.lines.reduce((sum, line) => sum + cents(line.credit), 0);
        expect(debits).toBe(credits);
        for (const line of entry.lines) expect(line.debit > 0 && line.credit > 0).toBe(false);
        expect(new Set(entry.lines.map((line) => line.accountId)).size).toBe(entry.lines.length);
      }),
      RUNS,
    );
  });

  it('refuses an entry that is off by even a cent', () => {
    fc.assert(
      fc.property(euros(1_000_000), fc.integer({ min: 1, max: 100 }), (amount, off) => {
        const builder = new EntryBuilder(links).debit('cash' as never, amount).credit('sales' as never, roundMoney(amount + off / 100));
        expect(() => builder.build('2026-10-01', 'off')).toThrow(/doesn't balance/);
      }),
      RUNS,
    );
  });
});

describe('Payroll', () => {
  const payInput = fc.record({
    secondary: fc.boolean(),
    nonResident: fc.boolean(),
    extraEmployee: fc.integer({ min: 0, max: 15 }),
    extraEmployer: fc.integer({ min: 0, max: 15 }),
  });
  const wage = euros(2_000_000); // up to €20,000 a month

  it('gross splits exactly into net, employee pension and tax; cost is gross plus employer pension', () => {
    fc.assert(
      fc.property(wage, payInput, (gross, input) => {
        const pay = payFromGross({ ...input, gross }, rules);
        expect(cents(pay.net) + cents(pay.employeePension) + cents(pay.tax)).toBe(cents(gross));
        expect(cents(pay.cost)).toBe(cents(gross) + cents(pay.employerPension));
        expect(cents(pay.tax)).toBe(pay.taxParts.reduce((sum, part) => sum + cents(part.tax), 0));
        expect(cents(pay.taxable)).toBe(cents(gross) - cents(pay.employeePension));
        expect(pay.taxParts.reduce((sum, part) => sum + cents(part.base), 0)).toBe(cents(pay.taxable));
        expect(pay.net).toBeGreaterThan(0);
        expect(pay.employeeRate).toBeLessThanOrEqual(rules.maxPensionEachSide);
        expect(pay.employerRate).toBeLessThanOrEqual(rules.maxPensionEachSide);
        if (input.nonResident) expect(pay.employeePension + pay.employerPension).toBe(0);
      }),
      RUNS,
    );
  });

  it('a cent more gross never gives less net', () => {
    fc.assert(
      fc.property(wage, payInput, (gross, input) => {
        const now = payFromGross({ ...input, gross }, rules).net;
        const more = payFromGross({ ...input, gross: roundMoney(gross + 0.01) }, rules).net;
        expect(more).toBeGreaterThanOrEqual(now);
      }),
      RUNS,
    );
  });

  it('net-agreed pay finds the lowest gross that pays at least the agreed net', () => {
    fc.assert(
      fc.property(euros(1_500_000), payInput, (net, input: Omit<PayInput, 'gross'>) => {
        const gross = grossFromNet(net, input, rules);
        expect(payFromGross({ ...input, gross }, rules).net).toBeGreaterThanOrEqual(net);
        expect(payFromGross({ ...input, gross: roundMoney(gross - 0.01) }, rules).net).toBeLessThan(net);
        // A net no gross can hit exactly is missed by at most one cent.
        expect(cents(payFromGross({ ...input, gross }, rules).net) - cents(net)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it('gross → net → gross comes back to the same gross', () => {
    fc.assert(
      fc.property(wage, payInput, (gross, input) => {
        const net = payFromGross({ ...input, gross }, rules).net;
        const back = grossFromNet(net, input, rules);
        // Several grosses can share a net (rounding); the lowest one is returned, never a higher one.
        expect(back).toBeLessThanOrEqual(gross);
        expect(payFromGross({ ...input, gross: back }, rules).net).toBe(net);
      }),
      { numRuns: 300 },
    );
  });
});
