import { describe, expect, it } from 'vitest';
import type { Product } from '../../services/types';
import { priceLine, summarise } from './basketMath';

const product = (patch: Partial<Product>): Product => ({
  id: 1,
  name: 'Coca-Cola 0.5L',
  description: null,
  sku: null,
  barcode: '3850000000001',
  otherBarcodes: [],
  imageUrl: null,
  isActive: true,
  category: { id: 1, name: 'Pije' },
  price: 1,
  vatRate: 18,
  vatExempt: false,
  originCountry: null,
  wholesalePrice: null,
  stock: { quantity: 50, reorderLevel: 5, isInStock: true, isLowStock: false },
  bulkPricingTiers: [],
  promotion: null,
  createdAt: '',
  updatedAt: '',
  ...patch,
});

const line = (patch: { quantity?: number; discount?: string; priceSet?: boolean } = {}) => ({ productId: 1, name: 'x', quantity: 1, discount: '', ...patch });

describe('pricing a counter line', () => {
  it('sells at the shelf price with no reason', () => {
    expect(priceLine(line({ quantity: 2 }), product({ price: 1.5 }), '')).toMatchObject({ listPrice: 1.5, unitPrice: 1.5, total: 3, percent: 0, reasons: [] });
  });

  it("uses the line's own rabat over the basket's, and says which", () => {
    expect(priceLine(line({ discount: '10' }), product({ price: 10 }), '5')).toMatchObject({ unitPrice: 9, percent: 10, reasons: [{ kind: 'rabat', percent: 10 }] });
    expect(priceLine(line(), product({ price: 10 }), '5')).toMatchObject({ unitPrice: 9.5, percent: 5, reasons: [{ kind: 'basketRabat', percent: 5 }] });
    expect(priceLine(line({ discount: '20', priceSet: true }), product({ price: 10 }), '')).toMatchObject({ unitPrice: 8, reasons: [{ kind: 'priceSet' }] });
  });

  it('names the bulk price and the promotion behind a lower list price', () => {
    const bulk = product({ price: 1, bulkPricingTiers: [{ quantity: 6, price: 0.9 }, { quantity: 12, price: 0.8 }] });
    expect(priceLine(line({ quantity: 8 }), bulk, '')).toMatchObject({ listPrice: 0.9, reasons: [{ kind: 'bulk', from: 6 }] });
    expect(priceLine(line({ quantity: 12 }), bulk, '')).toMatchObject({ listPrice: 0.8, reasons: [{ kind: 'bulk', from: 12 }] });
    const promoted = product({ price: 2, promotion: { id: 1, name: 'Vjeshta', percentOff: 25, endsAt: '', price: 1.5 } });
    expect(priceLine(line(), promoted, '')).toMatchObject({ listPrice: 1.5, reasons: [{ kind: 'promotion', name: 'Vjeshta' }] });
  });

  it('works out the VAT inside the price, none when exempt', () => {
    expect(priceLine(line(), product({ price: 11.8 }), '').vat).toBe(1.8);
    expect(priceLine(line(), product({ price: 10.8, vatRate: 8 }), '').vat).toBe(0.8);
    expect(priceLine(line(), product({ price: 5, vatRate: 0, vatExempt: true }), '').vat).toBe(0);
  });
});

describe("the basket's summary", () => {
  it('adds up pieces, the subtotal, the rabat and VAT per rate', () => {
    const lines = [
      priceLine(line({ quantity: 2, discount: '10' }), product({ price: 11.8 }), ''),
      priceLine({ ...line(), productId: 2 }, product({ id: 2, price: 10.8, vatRate: 8 }), ''),
    ];
    expect(summarise(lines)).toEqual({
      products: 2,
      pieces: 3,
      subtotal: 34.4,
      rabat: 2.36,
      total: 32.04,
      vat: [
        { rate: 18, amount: 3.24 },
        { rate: 8, amount: 0.8 },
      ],
    });
  });
});
