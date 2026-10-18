import { describe, expect, it } from 'vitest';
import { MissingTaxGroup, clearArticlesJob, pluFor, printerName, receiptJob, xReportJob, zReportJob } from './fiscalReceipt';

const groups = { '18': 5, '16': null, '8': 4, '0': null };
const milka = { id: 7, sku: '1483', name: 'Milka Oreo', vatRate: 18 as const };
const bread = { id: 12, sku: 'BUK-1', name: 'Bukë; e bardhë', vatRate: 8 as const };

describe('fiscal receipts', () => {
  it('writes a receipt the way the shop printer already reads them', () => {
    const job = receiptJob({
      lines: [
        { product: milka, unitPrice: 1.5, quantity: 1 },
        { product: bread, unitPrice: 0.4, quantity: 3 },
      ],
      footer: 'Ju faleminderit!',
      taxGroups: groups,
      payment: { by: 'cash', tendered: 5 },
    });
    expect(job.split('\r\n')).toEqual([
      'S,1,______,_,__;Milka Oreo;1.50;1;1;1;5;0;1483;0.00',
      'S,1,______,_,__;Bukë e bardhë;0.40;3;1;1;4;0;10012;0.00',
      'Q,1,______,_,__;1;Ju faleminderit!',
      'Q,1,______,_,__;2;',
      'T,1,______,_,__;0;5.00',
      '',
    ]);
  });

  it('pays the exact amount for card sales and keeps weights', () => {
    const job = receiptJob({ lines: [{ product: milka, unitPrice: 8.2, quantity: 0.775 }], footer: '', taxGroups: groups, payment: { by: 'card' } });
    expect(job).toContain(';8.20;0.775;');
    expect(job).toContain('T,1,______,_,__;0;\r\n');
  });

  it('refuses a rate the printer has no tax group for', () => {
    expect(() =>
      receiptJob({ lines: [{ product: { ...milka, vatRate: 0 }, unitPrice: 1, quantity: 1 }], footer: '', taxGroups: groups, payment: { by: 'card' } }),
    ).toThrow(MissingTaxGroup);
  });

  it('keeps article numbers and names inside what the printer takes', () => {
    expect(pluFor({ id: 3, sku: '339' })).toBe(339);
    expect(pluFor({ id: 3, sku: null })).toBe(10003);
    expect(pluFor({ id: 3, sku: '5901234123457' })).toBe(10003);
    expect(printerName('  A very long product name that goes on and on  ')).toHaveLength(32);
  });

  it('writes the reports', () => {
    expect(xReportJob()).toBe('X,1,______,_,__;\r\n');
    expect(zReportJob('4VD SH.P.K.')).toContain('Z,1,______,_,__;\r\n');
    expect(clearArticlesJob()).toBe('O,1,______,_,__;ALL\r\n');
  });
});
