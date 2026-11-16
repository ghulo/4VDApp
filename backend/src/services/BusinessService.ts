import type { LegalForm } from '../database/types.js';
import { NotFoundError } from '../errors/httpErrors.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { BusinessRepository, BusinessRow } from '../repositories/BusinessRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { mediaUrl } from './mappers.js';
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
}

const toDto = (business: BusinessRow): BusinessDto => ({
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
});

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

  async get(userId: number): Promise<BusinessDto> {
    return toDto(await this.businessOf(userId));
  }

  async update(userId: number, changes: BusinessChanges, logExtra?: Record<string, unknown>): Promise<BusinessDto> {
    const business = await this.businessOf(userId);
    const updated = await this.businessRepository.update(business.id, {
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.address !== undefined && { address: changes.address }),
      ...(changes.phone !== undefined && { phone: changes.phone }),
      ...(changes.nui !== undefined && { nui: changes.nui }),
      ...(changes.timeZone !== undefined && { time_zone: changes.timeZone }),
      ...(changes.bankName !== undefined && { bank_name: changes.bankName }),
      ...(changes.iban !== undefined && { iban: changes.iban }),
      ...(changes.invoiceNote !== undefined && { invoice_note: changes.invoiceNote }),
      ...(changes.legalForm !== undefined && { legal_form: changes.legalForm }),
    });
    // Every field that really changed, before and after, for the shop's history.
    const before = toDto(business) as unknown as Record<string, unknown>;
    const after = toDto(updated) as unknown as Record<string, unknown>;
    const fields = Object.keys(changes).filter((field) => (before[field] ?? null) !== (after[field] ?? null));
    if (fields.length > 0) {
      await this.activityLog.create({
        userId,
        action: 'business.updated',
        entityType: 'business',
        entityId: business.id,
        say: { key: 'shopChanged', params: { fields: fields as ShopField[] } },
        details: { fields: fields.map((field) => ({ field, from: before[field] ?? null, to: after[field] ?? null })), ...logExtra },
      });
    }
    return toDto(updated);
  }

  /** The logo, the stamp or the signature: a new picture replaces the old one. */
  async setPicture(userId: number, which: ShopPicture, upload: Buffer): Promise<BusinessDto> {
    const business = await this.businessOf(userId);
    const mediaId = await this.mediaService.store(business.id, upload, which);
    const updated = await this.businessRepository.update(business.id, { [PICTURE_COLUMN[which]]: mediaId });
    await this.mediaService.remove(business[PICTURE_COLUMN[which]]);
    await this.logPicture(userId, business.id, which, true);
    return toDto(updated);
  }

  async removePicture(userId: number, which: ShopPicture): Promise<BusinessDto> {
    const business = await this.businessOf(userId);
    const updated = await this.businessRepository.update(business.id, { [PICTURE_COLUMN[which]]: null });
    await this.mediaService.remove(business[PICTURE_COLUMN[which]]);
    await this.logPicture(userId, business.id, which, false);
    return toDto(updated);
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

  private async businessOf(userId: number): Promise<BusinessRow> {
    const user = await this.userRepository.findById(userId);
    const business = user ? await this.businessRepository.findById(user.business_id) : undefined;
    if (!business) throw new NotFoundError('No business found for this account');
    return business;
  }
}
