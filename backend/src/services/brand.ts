import type { BusinessRow } from '../repositories/BusinessRepository.js';
import { brandInitials, defaultBrandColour } from '../utils/brandColours.js';
import { FIRST_SHORT_NAME } from './BillEmailService.js';
import { mediaUrl } from './mappers.js';

/** 4VD's own amber, for 4VD's own business. */
export const HOUSE_COLOUR = '#f5b71a';

/**
 * How a business shows itself to its people and its customers: the dashboard,
 * sign-in from its link, the portal, emails. 4VD's own business (`house`)
 * keeps 4VD's logo and small print, and amber until its owner picks other
 * colours; every other one its own name, logo (or its initials on a key in its
 * colour) and colours. Only what a stranger on its sign-in page may see: no
 * address, NUI or bank.
 */
export interface BrandDto {
  house: boolean;
  name: string;
  /** #rrggbb: the owner's pick, or the business's default (amber for 4VD, a preset for the others). */
  colour: string;
  /** A second colour for charts and the marker, or null for the main one. */
  accent: string | null;
  /** Main → accent on the main key, the logo key and the marker. */
  gradient: boolean;
  greys: 'plain' | 'tinted';
  logoUrl: string | null;
  /** For the placeholder logo. */
  initials: string;
}

export type BrandRow = Pick<BusinessRow, 'name' | 'display_name' | 'short_name' | 'brand_colour' | 'brand_accent' | 'brand_gradient' | 'brand_greys' | 'logo_media_id'>;
/** The columns brandOf reads, for repositories that select them. */
export const BRAND_COLUMNS = ['name', 'display_name', 'short_name', 'brand_colour', 'brand_accent', 'brand_gradient', 'brand_greys', 'logo_media_id'] as const;

export const isHouseBusiness = (business: Pick<BusinessRow, 'short_name'>) => business.short_name === FIRST_SHORT_NAME;

/** The colours a business starts with, and goes back to on "Reset to default". */
export function defaultTheme(business: Pick<BusinessRow, 'short_name'>): { colour: string; greys: 'plain' | 'tinted' } {
  return isHouseBusiness(business) ? { colour: HOUSE_COLOUR, greys: 'plain' } : { colour: defaultBrandColour(business.short_name), greys: 'tinted' };
}

export function brandOf(business: BrandRow): BrandDto {
  const name = business.display_name?.trim() || business.name;
  const house = isHouseBusiness(business);
  const start = defaultTheme(business);
  return {
    house,
    name,
    colour: business.brand_colour ?? start.colour,
    accent: business.brand_accent,
    gradient: business.brand_gradient,
    greys: business.brand_greys ?? start.greys,
    // 4VD keeps its family-home logo; its uploaded logo is only for its documents.
    logoUrl: house ? null : mediaUrl(business.logo_media_id),
    initials: brandInitials(name),
  };
}
