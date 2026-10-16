/**
 * The kinds of line one supplier bill can mix: a product that goes into stock,
 * a cost with a plain category (rent, power, transport…), or equipment the
 * business keeps (a fridge, a till, a van), booked as a fixed asset ready to
 * depreciate. 4VD works out the kind of bill from its lines and its supplier,
 * so nobody picks a document type.
 */
export const BILL_LINE_KINDS = ['product', 'cost', 'equipment'] as const;
export type BillLineKind = (typeof BILL_LINE_KINDS)[number];

/** What equipment is, each booked to its own fixed-asset account (`asset:<category>`). */
export const EQUIPMENT_CATEGORIES = ['furniture', 'equipment', 'vehicle', 'building', 'other'] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

/** A bill, or the return or credit a supplier gives back against one of their bills. */
export const BILL_KINDS = ['bill', 'credit'] as const;
export type BillKind = (typeof BILL_KINDS)[number];

/**
 * Tax held back from a supplier and paid to ATK instead (withholding), the
 * seven kinds on ATK's form, with their rates in percent. Booked to the
 * withholding account (2370).
 */
export const WITHHOLDING_RATES = {
  interest: 10,
  royalties: 10,
  lottery: 10,
  rent: 9,
  entertainers: 5,
  nonresident_services: 5,
  special: 3,
} as const;
export type WithholdingType = keyof typeof WITHHOLDING_RATES;
export const WITHHOLDING_TYPES = ['interest', 'royalties', 'lottery', 'rent', 'entertainers', 'nonresident_services', 'special'] as const satisfies readonly WithholdingType[];

/** The VAT rates a bill line can have. */
export const BILL_VAT_RATES = [18, 8, 0] as const;

/**
 * VAT on a service bought from abroad, which the shop charges itself: owed and
 * claimed back at once, so it nets to zero (reverse charge, never named as such).
 */
export const SELF_CHARGE_VAT_RATE = 18;

/** How the customs VAT and duty on an import were paid at the border. */
export const CUSTOMS_PAID_METHODS = ['bank', 'cash'] as const;
export type CustomsPaidMethod = (typeof CUSTOMS_PAID_METHODS)[number];
