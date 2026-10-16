import { z } from 'zod';
import { money } from './catalogValidators.js';
import { BILL_LINE_KINDS, CUSTOMS_PAID_METHODS, WITHHOLDING_TYPES } from '../constants/bills.js';
import { EXPENSE_PLACES } from '../constants/expenses.js';
import { SUPPLIER_PAYMENT_METHODS } from '../database/types.js';
import { calendarDaySchema, idSchema, nuiSchema } from './validate.js';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'give the supplier a name').max(120),
  nui: nuiSchema,
  phone: optional(40),
  email: z
    .string()
    .trim()
    .email('must be an email address')
    .max(255)
    .nullish()
    .or(z.literal(''))
    .transform((value) => value || null),
  note: optional(500),
  /** From another country: its bills are imports. */
  abroad: z.boolean().optional(),
  usualKind: z.enum(BILL_LINE_KINDS).nullish(),
  usualCategory: z.string().trim().max(32).nullish(),
  usualVatRate: z.union([z.literal(18), z.literal(8), z.literal(0)]).nullish(),
  withholdingType: z.enum(WITHHOLDING_TYPES).nullish(),
});

export const newOrderSchema = z.object({
  supplierId: idSchema,
  note: optional(500),
  lines: z
    .array(
      z.object({
        productId: idSchema,
        quantity: z.number().int().min(1).max(100_000),
        unitCost: money.nullish().transform((value) => value ?? null),
      }),
    )
    .min(1, 'add at least one product')
    .max(200),
});

export const receiveOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: idSchema,
        receivedQuantity: z.number().int().min(0).max(100_000),
        unitCost: money.nullish().transform((value) => value ?? null),
        /** When what came expires, for products that go off. */
        expiresOn: calendarDaySchema.nullish().transform((value) => value ?? null),
      }),
    )
    .max(200),
  updateCostPrices: z.boolean().default(false),
  /** The supplier's bill for this delivery, when it came with one. */
  bill: z.lazy(() => billSchema).optional(),
});

const positiveMoney = money.refine((value) => value > 0, 'must be more than 0');

export const billSchema = z
  .object({
    number: optional(60),
    issuedOn: calendarDaySchema,
    dueOn: calendarDaySchema.nullish().transform((value) => value ?? null),
    amount: positiveMoney,
    /** The VAT in the amount, to claim back; left out when unknown. */
    vatAmount: money.nullish(),
    note: optional(500),
  })
  .refine((bill) => bill.vatAmount === undefined || bill.vatAmount === null || bill.vatAmount < bill.amount, {
    message: "the VAT has to be less than the bill's total",
    path: ['vatAmount'],
  });

export const newBillSchema = z.intersection(billSchema, z.object({ supplierId: idSchema, orderId: idSchema.nullish() }));

const vatRateSchema = z.union([z.literal(18), z.literal(8), z.literal(0)]);
/** A price for one, to the tenth of a cent (prices without VAT often have more than two decimals). */
const unitPriceSchema = z.number().nonnegative().max(1_000_000).transform((value) => Math.round(value * 10_000) / 10_000);

export const billLineSchema = z.object({
  kind: z.enum(BILL_LINE_KINDS),
  productId: idSchema.nullish(),
  quantity: z.number().int().min(1).max(100_000).nullish(),
  unitPrice: unitPriceSchema.nullish(),
  category: z.string().trim().max(32).nullish(),
  description: optional(300),
  amount: positiveMoney.nullish(),
  vatRate: vatRateSchema.nullish(),
});

/** The one bill form: lines of products, costs and equipment, and what 4VD needs to work out the rest. */
export const billFormSchema = z.object({
  supplierId: idSchema.nullish().transform((value) => value ?? null),
  number: optional(60),
  issuedOn: calendarDaySchema,
  dueOn: calendarDaySchema.nullish().transform((value) => value ?? null),
  note: optional(500),
  lines: z.array(billLineSchema).min(1, 'add at least one line').max(300),
  pricesIncludeVat: z.boolean().default(true),
  customs: z
    .object({ vat: money, duty: money, method: z.enum(CUSTOMS_PAID_METHODS).default('bank') })
    .nullish()
    .transform((value) => value ?? null),
  withholdingType: z.enum(WITHHOLDING_TYPES).nullish().transform((value) => value ?? null),
  paidNow: z
    .object({ method: z.enum(SUPPLIER_PAYMENT_METHODS) })
    .nullish()
    .transform((value) => value ?? null),
  place: z.enum(EXPENSE_PLACES).default('shop'),
  carwashId: idSchema.nullish().transform((value) => value ?? null),
  repeatMonthly: z.boolean().default(false),
  updateCosts: z.boolean().default(true),
  prices: z
    .array(z.object({ productId: idSchema, price: positiveMoney }))
    .max(300)
    .default([]),
});

/** A bill typed as a total (the old form) or with lines (the one bill form). */
export const anyNewBillSchema = z.union([billFormSchema, newBillSchema]);

export const creditSchema = z.object({
  returnsStock: z.boolean(),
  number: optional(60),
  issuedOn: calendarDaySchema,
  note: optional(500),
  pricesIncludeVat: z.boolean().optional(),
  lines: z.array(billLineSchema).min(1, 'add at least one line').max(300),
});

export const billQuerySchema = z.object({
  supplierId: z.coerce.number().int().positive().optional(),
  status: z.enum(['open', 'paid', 'void']).optional(),
});

export const paymentSchema = z.object({
  amount: positiveMoney,
  paidOn: calendarDaySchema,
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  note: optional(500),
});

export const voidBillSchema = z.object({ note: z.string().trim().min(1, 'say why').max(500) });

export const paymentParamsSchema = z.object({ id: idSchema, paymentId: idSchema });

/** A scanned bill's pages, read in the browser or on the phone as base64. */
export const scanUploadSchema = z.object({
  pages: z
    .array(
      z.object({
        mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
        data: z.string().min(1),
      }),
    )
    .min(1, 'add a photo or PDF of the bill')
    .max(6, 'at most 6 pages'),
});

export const scanQuerySchema = z.object({ supplierId: z.coerce.number().int().positive().optional() });

const barcodeSchema = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((value) => value || null);

export const confirmScanSchema = z.object({
  supplierId: idSchema,
  orderId: idSchema.nullable(),
  bill: billSchema,
  categoryId: idSchema.nullable(),
  lines: z
    .array(
      z.object({
        /** Which line of the reading this is, so a reopened scan can show the same choices. */
        readIndex: z.number().int().nonnegative().optional(),
        productId: idSchema.nullable(),
        newProduct: z
          .object({
            name: z.string().trim().min(1, 'give the new product a name').max(255),
            barcode: barcodeSchema,
            price: positiveMoney,
            vatRate: z.union([z.literal(0), z.literal(8), z.literal(18)]),
          })
          .nullable(),
        code: optional(64),
        pieces: z.number().int().positive(),
        unitsPerPack: z.number().int().positive().max(10_000),
        unitCost: money.nullable(),
        updateCost: z.boolean(),
        barcode: barcodeSchema,
        updateBarcode: z.boolean(),
      }),
    )
    .max(500),
});
