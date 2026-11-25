import type { LegalForm } from '../database/types.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/httpErrors.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { billAddressOf } from './BillEmailService.js';
import { currentBusinessId } from '../database/businessContext.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { BusinessRepository, BusinessRow } from '../repositories/BusinessRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { mediaUrl } from './mappers.js';
import { brandOf, defaultTheme, type BrandDto } from './brand.js';
import type { StoredBrandTheme } from '../database/types.js';
import type { MediaService } from './MediaService.js';
import type { ShopField } from '../i18n/activityText.js';

export interface BusinessDto {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  nui: string | null;
  currency: string;
  timeZone: string | null;
  logoUrl: string | null;
  stampUrl: string | null;
  signatureUrl: string | null;
  bankName: string | null;
  iban: string | null;
  invoiceNote: string | null;
  /** 'company' files the CD, 'individual' (B.I.) the PD. */
  legalForm: LegalForm;
  shortName: string | null;
  /** Where suppliers email this business's bills. */
  billAddress: string;
  /** The name shown instead of the legal name (null = the legal name). */
  displayName: string | null;
  /** The colours the owner picked (null = not picked: brand holds the default). */
  brandColour: string | null;
  brandAccent: string | null;
  brandGradient: boolean;
  brandGreys: 'plain' | 'tinted' | null;
  /** The colours before the last change, for "Back to previous" (null = none yet). */
  brandPrevious: StoredBrandTheme | null;
  /** What "Reset to default" goes back to. */
  brandDefault: { colour: string; greys: 'plain' | 'tinted' };
  /** Lines printed under the name on documents. */
  receiptHeader: string | null;
  /** How it shows itself: 4VD's own look, or its own name, logo and colours. */
  brand: BrandDto;
  /** It has an open carwash: carwash takings, drawers and lines show only then. */
  hasCarwash: boolean;
  /** It came from TREFIN (its history was brought over, or it is 4VD's own shop): TREFIN filters and pages show only then. */
  hasTrefin: boolean;
  /** When the business was added, so screens show nothing from before it existed. */
  createdAt: string;
}

export interface BusinessChanges {
  name?: string;
  address?: string | null;
  phone?: string | null;
  nui?: string;
  timeZone?: string | null;
  bankName?: string | null;
  iban?: string | null;
  invoiceNote?: string | null;
  legalForm?: LegalForm;
  shortName?: string;
  displayName?: string | null;
  brandColour?: string | null;
  brandAccent?: string | null;
  brandGradient?: boolean;
  brandGreys?: 'plain' | 'tinted' | null;
  receiptHeader?: string | null;
}

const toDto = (business: BusinessRow, setUp: { carwash: boolean; trefin: boolean } = { carwash: false, trefin: false }): BusinessDto => ({
  id: business.id,
  name: business.name,
  address: business.address,
  phone: business.phone,
  nui: business.nui,
  currency: business.currency,
  timeZone: business.time_zone,
  logoUrl: mediaUrl(business.logo_media_id),
  stampUrl: mediaUrl(business.stamp_media_id),
  signatureUrl: mediaUrl(business.signature_media_id),
  bankName: business.bank_name,
  iban: business.iban,
  invoiceNote: business.invoice_note,
  legalForm: business.legal_form,
  shortName: business.short_name,
  billAddress: billAddressOf(business.short_name),
  displayName: business.display_name,
  brandColour: business.brand_colour,
  brandAccent: business.brand_accent,
  brandGradient: business.brand_gradient,
  brandGreys: business.brand_greys,
  brandPrevious: business.brand_previous,
  brandDefault: defaultTheme(business),
  receiptHeader: business.receipt_header,
  brand: brandOf(business),
  hasCarwash: setUp.carwash,
  hasTrefin: setUp.trefin || brandOf(business).house,
  createdAt: business.created_at.toISOString(),
});

const THEME_FIELDS: string[] = ['brandColour', 'brandAccent', 'brandGradient', 'brandGreys'];
const themeOf = (business: BusinessRow): StoredBrandTheme => ({ colour: business.brand_colour, accent: business.brand_accent, gradient: business.brand_gradient, greys: business.brand_greys });

export type ShopPicture = 'logo' | 'stamp' | 'signature';
const PICTURE_COLUMN = { logo: 'logo_media_id', stamp: 'stamp_media_id', signature: 'signature_media_id' } as const;

/** The shop's own details: name, address, phone, NUI, time zone, logo, stamp, signature and bank account. */
export class BusinessService {
  constructor(
    private readonly businessRepository: BusinessRepository,
    private readonly userRepository: UserRepository,
    private readonly mediaService: MediaService,
    private readonly activityLog: ActivityLogRepository,
  ) {}

  /**
   * What a stranger on a business's own sign-in link sees: its name, logo and
   * colours, nothing else. Runs under the system context (the route sets it).
   */
  async publicBrand(shortName: string): Promise<BrandDto> {
    const business = await this.businessRepository.findByShortName(shortName);
    if (!business) throw new NotFoundError('No business uses this link');
    return brandOf(business);
  }

  async get(userId: number): Promise<BusinessDto> {
    const business = await this.businessOf(userId);
    return toDto(business, await this.businessRepository.setUp(business.id));
  }

  async update(userId: number, changes: BusinessChanges, logExtra?: Record<string, unknown>): Promise<BusinessDto> {
    const business = await this.businessOf(userId);
    if (changes.shortName !== undefined && changes.shortName !== business.short_name) {
      if (!(await this.userRepository.findById(userId))?.is_platform_developer) throw new ForbiddenError("Only 4VD's developer can change the bill address");
    }
    // A colour change keeps the colours it replaces, so one click can go back to them.
    const themeBefore = themeOf(business);
    const themeAfter: StoredBrandTheme = {
      colour: changes.brandColour !== undefined ? (changes.brandColour?.toLowerCase() ?? null) : themeBefore.colour,
      accent: changes.brandAccent !== undefined ? (changes.brandAccent?.toLowerCase() ?? null) : themeBefore.accent,
      gradient: changes.brandGradient ?? themeBefore.gradient,
      greys: changes.brandGreys !== undefined ? changes.brandGreys : themeBefore.greys,
    };
    const themeChanged = JSON.stringify(themeAfter) !== JSON.stringify(themeBefore);
    const updated = await this.businessRepository.update(business.id, {
      ...(changes.shortName !== undefined && { short_name: changes.shortName }),
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.address !== undefined && { address: changes.address }),
      ...(changes.phone !== undefined && { phone: changes.phone }),
      ...(changes.nui !== undefined && { nui: changes.nui }),
      ...(changes.timeZone !== undefined && { time_zone: changes.timeZone }),
      ...(changes.bankName !== undefined && { bank_name: changes.bankName }),
      ...(changes.iban !== undefined && { iban: changes.iban }),
      ...(changes.invoiceNote !== undefined && { invoice_note: changes.invoiceNote }),
      ...(changes.legalForm !== undefined && { legal_form: changes.legalForm }),
      ...(changes.displayName !== undefined && { display_name: changes.displayName }),
      ...(themeChanged && {
        brand_colour: themeAfter.colour,
        brand_accent: themeAfter.accent,
        brand_gradient: themeAfter.gradient,
        brand_greys: themeAfter.greys,
        brand_previous: themeBefore,
      }),
      ...(changes.receiptHeader !== undefined && { receipt_header: changes.receiptHeader }),
    }).catch((error: unknown) => {
      if (isUniqueViolation(error, 'businesses_short_name_key')) throw new ConflictError(`${billAddressOf(changes.shortName ?? null)} is already used by another business`);
      throw error;
    });
    // Every field that really changed, before and after, for the shop's history.
    const before = toDto(business) as unknown as Record<string, unknown>;
    const after = toDto(updated) as unknown as Record<string, unknown>;
    const fields = [
      ...Object.keys(changes).filter((field) => !THEME_FIELDS.includes(field) && (before[field] ?? null) !== (after[field] ?? null)),
      ...(themeChanged ? ['colours'] : []),
    ];
    if (fields.length > 0) {
      await this.activityLog.create({
        userId,
        action: 'business.updated',
        entityType: 'business',
        entityId: business.id,
        say: { key: 'shopChanged', params: { fields: fields as ShopField[] } },
        details: {
          fields: fields.map((field) => (field === 'colours' ? { field, from: themeBefore, to: themeAfter } : { field, from: before[field] ?? null, to: after[field] ?? null })),
          ...logExtra,
        },
      });
    }
    return toDto(updated, await this.businessRepository.setUp(updated.id));
  }

  /** The logo, the stamp or the signature: a new picture replaces the old one. */
  async setPicture(userId: number, which: ShopPicture, upload: Buffer): Promise<BusinessDto> {
    const business = await this.businessOf(userId);
    const mediaId = await this.mediaService.store(business.id, upload, which);
    const updated = await this.businessRepository.update(business.id, { [PICTURE_COLUMN[which]]: mediaId });
    await this.mediaService.remove(business[PICTURE_COLUMN[which]]);
    await this.logPicture(userId, business.id, which, true);
    return toDto(updated, await this.businessRepository.setUp(updated.id));
  }

  async removePicture(userId: number, which: ShopPicture): Promise<BusinessDto> {
    const business = await this.businessOf(userId);
    const updated = await this.businessRepository.update(business.id, { [PICTURE_COLUMN[which]]: null });
    await this.mediaService.remove(business[PICTURE_COLUMN[which]]);
    await this.logPicture(userId, business.id, which, false);
    return toDto(updated, await this.businessRepository.setUp(updated.id));
  }

  async setLogo(userId: number, upload: Buffer): Promise<BusinessDto> {
    return this.setPicture(userId, 'logo', upload);
  }

  async removeLogo(userId: number): Promise<BusinessDto> {
    return this.removePicture(userId, 'logo');
  }

  /** The stamp and signature sign every invoice, so who changed them is kept. */
  private async logPicture(userId: number, businessId: number, which: ShopPicture, added: boolean): Promise<void> {
    if (which === 'logo') return;
    await this.activityLog.create({
      userId,
      action: added ? 'business.picture_set' : 'business.picture_removed',
      entityType: 'business',
      entityId: businessId,
      say: { key: added ? 'shopPictureSet' : 'shopPictureRemoved', params: { which } },
      details: { which },
    });
  }

  /** The business open in this request (not the person's home business). */
  private async businessOf(_userId: number): Promise<BusinessRow> {
    const businessId = currentBusinessId();
    const business = businessId === null ? undefined : await this.businessRepository.findById(businessId);
    if (!business) throw new NotFoundError('No business found for this account');
    return business;
  }
}
