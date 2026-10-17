import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { billsAddingUpTo, nameIn, numberIn, suggest } from '../src/services/money/matching.js';
import { applyLayout, detectLayout, fingerprints, layoutFits, parseDay, parseMoney, readCsv, readXlsx } from '../src/services/money/statementFile.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/statements/${name}`, import.meta.url));

describe('reading amounts and days the way Kosovo banks write them', () => {
  it('reads money with comma or point decimals, signs and currency', () => {
    expect(parseMoney('1.234,56')).toBe(1234.56);
    expect(parseMoney('1,234.56')).toBe(1234.56);
    expect(parseMoney('845,60')).toBe(845.6);
    expect(parseMoney('-45,00')).toBe(-45);
    expect(parseMoney('(45.00)')).toBe(-45);
    expect(parseMoney('12,50 EUR')).toBe(12.5);
    expect(parseMoney('1.200')).toBe(1200);
    expect(parseMoney('2.5')).toBe(2.5);
    expect(parseMoney(17.3)).toBe(17.3);
    expect(parseMoney('Gjithsej')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });

  it('reads days as dd.mm.yyyy, ISO, slashes and Excel dates', () => {
    expect(parseDay('13.10.2026')).toBe('2026-10-13');
    expect(parseDay('13/10/2026')).toBe('2026-10-13');
    expect(parseDay('13.10.26')).toBe('2026-10-13');
    expect(parseDay('2026-10-13')).toBe('2026-10-13');
    expect(parseDay('13.10.2026 14:22')).toBe('2026-10-13');
    expect(parseDay(new Date(Date.UTC(2026, 9, 13)))).toBe('2026-10-13');
    expect(parseDay(46308)).toBe('2026-10-13');
    expect(parseDay('31.02.2026')).toBeNull();
    expect(parseDay('Data')).toBeNull();
  });
});

describe('reading a statement file', () => {
  it('finds the columns of a Kosovo CSV with Debi and Kredi under a heading block, and leaves the totals row out', () => {
    const rows = readCsv(fixture('kosovo-debi-kredi.csv'));
    const detected = detectLayout(rows)!;
    expect(detected.sure).toBe(true);
    expect(detected.layout).toMatchObject({ headerRow: 4, date: 0, text: 2, moneyOut: 3, moneyIn: 4, amount: null, balance: 5 });
    const read = applyLayout(rows, detected.layout);
    expect(read.unreadable).toBe(0);
    expect(read.lines.map((line) => [line.day, line.amount])).toEqual([
      ['2026-10-01', 1200],
      ['2026-10-03', -845.6],
      ['2026-10-05', -4.5],
      ['2026-10-08', -650],
      ['2026-10-10', 236],
    ]);
    expect(read.lines[1]!.text).toBe('Pagesë fatura 2026/0457 Viva Fresh Sh.p.k.');
    expect(read.openingBalance).toBe(2250.75);
    expect(read.closingBalance).toBe(2186.65);
  });

  it('reads one signed amount column, and turns a newest-first statement round', () => {
    const rows = readCsv(fixture('english-signed-newest-first.csv'));
    const detected = detectLayout(rows)!;
    expect(detected.sure).toBe(true);
    const read = applyLayout(rows, detected.layout);
    expect(read.lines.map((line) => line.day)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13']);
    expect(read.openingBalance).toBe(1502);
    expect(read.closingBalance).toBe(1320.5);
  });

  it('reads an Excel export, with real dates and numbers in its cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ekstrakti');
    sheet.addRow(['Llogaria', 'XK05 1212 0123 4567 8906']);
    sheet.addRow([]);
    sheet.addRow(['Data e transaksionit', 'Përshkrimi', 'Përfituesi', 'Debi', 'Kredi', 'Bilanci']);
    sheet.addRow([new Date(Date.UTC(2026, 9, 2)), 'Pagesë', 'Viva Fresh', 120.4, null, 879.6]);
    sheet.addRow([new Date(Date.UTC(2026, 9, 3)), 'Depozitë', null, null, 500, 1379.6]);
    const rows = await readXlsx(Buffer.from(await workbook.xlsx.writeBuffer()));
    const detected = detectLayout(rows)!;
    expect(detected.sure).toBe(true);
    const read = applyLayout(rows, detected.layout);
    expect(read.lines).toEqual([
      { day: '2026-10-02', text: 'Pagesë · Viva Fresh', amount: -120.4, balance: 879.6 },
      { day: '2026-10-03', text: 'Depozitë', amount: 500, balance: 1379.6 },
    ]);
  });

  it("asks when the headers say nothing, and knows a saved layout again", () => {
    const rows = readCsv(Buffer.from('K1;K2;K3\n01.10.2026;Something;12,00\n02.10.2026;Other;-3,00\n'));
    expect(detectLayout(rows)?.sure ?? false).toBe(false);
    const layout = { headerRow: 0, date: 0, text: 1, party: null, moneyIn: null, moneyOut: null, amount: 2, balance: null, headers: ['K1', 'K2', 'K3'] };
    expect(applyLayout(rows, layout).lines).toHaveLength(2);
    expect(layoutFits(rows, layout)).toMatchObject({ headerRow: 0 });
    expect(layoutFits(readCsv(Buffer.from('A;B\n')), layout)).toBeNull();
  });

  it('gives the same line the same fingerprint, and two identical lines different ones', () => {
    const line = { day: '2026-10-05', text: 'Provizion', amount: -4.5, balance: null };
    const [first, second] = fingerprints([line, line]);
    expect(first).not.toBe(second);
    expect(fingerprints([line])[0]).toBe(first);
  });
});

describe('suggesting what a line is', () => {
  const bill = (id: number, left: number, number: string | null, issuedOn = '2026-10-01') => ({ id, supplierId: 7, supplierName: 'Viva Fresh Sh.p.k.', number, issuedOn, left });
  const empty = { bills: [], items: [], payments: [], groups: [], receipts: [], moves: [], rules: [], shopTillId: 1 };

  it('finds names and numbers as whole words, without legal endings', () => {
    expect(nameIn('PAGESE VIVA FRESH STORE', 'Viva Fresh Sh.p.k.')).toBe(true);
    expect(nameIn('Pagesë Vivafresh', 'Viva Fresh')).toBe(false);
    expect(nameIn('ABC payment', 'ABC')).toBe(false);
    expect(numberIn('Fat. nr 2026/0457', '2026/0457')).toBe(true);
    expect(numberIn('Fat. nr 12', '12')).toBe(false);
  });

  it('adds up several bills, the oldest first', () => {
    const bills = [bill(1, 100, 'A'), bill(2, 50, 'B'), bill(3, 30, 'C')];
    expect(billsAddingUpTo(bills, 150)?.map((picked) => picked.id)).toEqual([1, 2]);
    expect(billsAddingUpTo(bills, 130)?.map((picked) => picked.id)).toEqual([1, 3]);
    expect(billsAddingUpTo(bills, 7)).toBeNull();
  });

  it('is sure of a bill when its amount fits and the supplier is named, and only guesses on the amount alone', () => {
    const line = { day: '2026-10-03', text: 'Pagesë Viva Fresh', amount: -845.6 };
    const [first] = suggest(line, { ...empty, bills: [bill(1, 845.6, '2026/0457')] });
    expect(first).toMatchObject({ sure: true, action: { kind: 'payBills', supplierId: 7, bills: [{ billId: 1, amount: 845.6 }] } });
    expect(first!.reasons).toEqual([{ key: 'sameAmount' }, { key: 'nameInText', name: 'Viva Fresh Sh.p.k.' }]);

    const [guess] = suggest({ ...line, text: 'Transfer' }, { ...empty, bills: [bill(1, 845.6, '2026/0457')] });
    expect(guess).toMatchObject({ sure: false, reasons: [{ key: 'sameAmount' }] });
  });

  it('pays several bills from one line when their numbers are in the text', () => {
    const [first] = suggest({ day: '2026-10-03', text: 'Fat 2026/0457 dhe 2026/0460', amount: -150 }, { ...empty, bills: [bill(1, 100, '2026/0457'), bill(2, 50, '2026/0460'), bill(3, 50, '2026/0461')] });
    expect(first).toMatchObject({ sure: true, action: { kind: 'payBills', bills: [{ billId: 1 }, { billId: 2 }] }, reasons: [{ key: 'sumOfBills', count: 2 }, { key: 'numberInText' }, { key: 'numberInText' }] });
  });

  it('follows a saved rule, and finds a deposit from the till', () => {
    const rules = [{ id: 4, contains: 'Provizion', direction: 'out' as const, action: 'expense' as const, category: 'bank_fees', supplierId: null, otherPlaceId: null }];
    expect(suggest({ day: '2026-10-05', text: 'Provizion mujor', amount: -4.5 }, { ...empty, rules })[0]).toMatchObject({ sure: true, ruleId: 4, action: { kind: 'expense', category: 'bank_fees' } });
    expect(suggest({ day: '2026-10-01', text: 'Depozitë në para të gatshme', amount: 1200 }, empty)[0]).toMatchObject({ sure: false, action: { kind: 'move', otherPlaceId: 1 }, reasons: [{ key: 'depositWords' }] });
    const moves = [{ id: 9, day: '2026-09-30', amount: 1200, name: null, otherPlaceId: 1 }];
    expect(suggest({ day: '2026-10-01', text: 'Depozitë', amount: 1200 }, { ...empty, moves })[0]).toMatchObject({ sure: true, action: { kind: 'linkMove', moveId: 9 }, reasons: [{ key: 'sameAmount' }, { key: 'daysApart', days: 1 }] });
  });

  it("receives a customer's invoice by its number", () => {
    const items = [{ customerId: 3, customerName: 'Dardania Trade LLC', documentId: 21, number: 'INV-0012', date: '2026-09-20', left: 236 }];
    expect(suggest({ day: '2026-10-10', text: 'Pagesë nga Dardania Trade LLC fat. INV-0012', amount: 236 }, { ...empty, items })[0]).toMatchObject({
      sure: true,
      action: { kind: 'receive', customerId: 3, allocations: [{ documentId: 21, amount: 236 }] },
    });
  });
});
