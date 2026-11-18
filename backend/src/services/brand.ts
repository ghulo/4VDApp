import type { BusinessRow } from '../repositories/BusinessRepository.js';
import { brandInitials, defaultBrandColour } from '../utils/brandColours.js';
import { FIRST_SHORT_NAME } from './BillEmailService.js';
import { mediaUrl } from './mappers.js';

/** 4VD's own amber, for 4VD's own business. */
export const HOUSE_COLOUR = '#f5b71a';

/**
 * How a business shows itself to its people and its customers: the dashboard,
 * sign-in from its link, the portal, emails. 4VD's own business (`house`)
 * keeps 4VD's look, logo and amber; every other one its own name, logo (or
 * its initials on a key in its colour) and colour. Only what a stranger on its
 * sign-in page may see: no address, NUI or bank.
 */
export interface BrandDto {
  house: boolean;
  name: string;
  /** #rrggbb: the owner's pick, or the business's default preset. */
  colour: string;
  greys: 'plain' | 'tinted';
  logoUrl: string | null;
  /** For the placeholder logo. */
  initials: string;
}

type BrandRow = Pick<BusinessRow, 'name' | 'display_name' | 'short_name' | 'brand_colour' | 'brand_greys' | 'logo_media_id'>;

export const isHouseBusiness = (business: Pick<BusinessRow, 'short_name'>) => business.short_name === FIRST_SHORT_NAME;

export function brandOf(business: BrandRow): BrandDto {
  const name = business.display_name?.trim() || business.name;
  if (isHouseBusiness(business)) {
    return { house: true, name, colour: HOUSE_COLOUR, greys: 'plain', logoUrl: null, initials: brandInitials(name) };
  }
  return {
    house: false,
    name,
    colour: business.brand_colour ?? defaultBrandColour(business.short_name),
    greys: business.brand_greys,
    logoUrl: mediaUrl(business.logo_media_id),
    initials: brandInitials(name),
  };
}
