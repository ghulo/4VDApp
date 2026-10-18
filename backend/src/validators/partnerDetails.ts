import { z } from 'zod';

/**
 * The details a supplier or customer can carry besides name, NUI and phone:
 * the ones TREFIN kept for every partner, as real fields both lists share.
 */
/** Left out: kept as it is (older screens don't send these); empty: cleared. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined ? undefined : value || null));

export const partnerDetailsShape = {
  address: text(200),
  city: text(80),
  /** The business registration no. (NRB). */
  businessNo: text(40),
  fiscalNo: text(40),
  vatNo: text(40),
  iban: text(60),
  contactPerson: text(120),
  mobile: text(40),
};

export interface PartnerDetails {
  address: string | null;
  city: string | null;
  businessNo: string | null;
  fiscalNo: string | null;
  vatNo: string | null;
  iban: string | null;
  contactPerson: string | null;
  mobile: string | null;
}

const COLUMNS = {
  address: 'address',
  city: 'city',
  businessNo: 'business_no',
  fiscalNo: 'fiscal_no',
  vatNo: 'vat_no',
  iban: 'iban',
  contactPerson: 'contact_person',
  mobile: 'mobile',
} as const satisfies Record<keyof PartnerDetails, string>;

/** The details as select columns, named as in PartnerDetails. */
export const PARTNER_DETAIL_COLUMNS = [
  'address',
  'city',
  'business_no as businessNo',
  'fiscal_no as fiscalNo',
  'vat_no as vatNo',
  'iban',
  'contact_person as contactPerson',
  'mobile',
] as const;

/** The columns to write for the details given; a detail left out stays as it is. */
export function partnerDetailRow(input: Partial<PartnerDetails>) {
  const row: Partial<Record<(typeof COLUMNS)[keyof PartnerDetails], string | null>> = {};
  for (const [key, column] of Object.entries(COLUMNS) as Array<[keyof PartnerDetails, (typeof COLUMNS)[keyof PartnerDetails]]>) {
    if (input[key] !== undefined) row[column] = input[key];
  }
  return row;
}
