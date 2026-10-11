import { NotFoundError } from '../errors/httpErrors.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { BusinessRepository, BusinessRow } from '../repositories/BusinessRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { mediaUrl } from './mappers.js';
import type { MediaService } from './MediaService.js';

export interface BusinessDto {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  nui: string | null;
  currency: string;
  timeZone: string | null;
  logoUrl: string | null;
  bankName: string | null;
  iban: string | null;
  invoiceNote: string | null;
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
}

const FIELD_NAMES: Record<string, string> = {
  name: 'name',
  address: 'address',
  phone: 'phone',
  nui: 'NUI',
  timeZone: 'time zone',
  bankName: 'bank',
  iban: 'IBAN',
  invoiceNote: 'invoice note',
};

const toDto = (business: BusinessRow): BusinessDto => ({
  id: business.id,
  name: business.name,
  address: business.address,
  phone: business.phone,
  nui: business.nui,
  currency: business.currency,
  timeZone: business.time_zone,
  logoUrl: mediaUrl(business.logo_media_id),
  bankName: business.bank_name,
  iban: business.iban,
  invoiceNote: business.invoice_note,
});

/** The shop's own details: name, address, phone, NUI, time zone, logo and bank account. */
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

  async update(userId: number, changes: BusinessChanges): Promise<BusinessDto> {
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
        summary: `Changed the shop's ${fields.map((field) => FIELD_NAMES[field] ?? field).join(', ')}`,
        details: { fields: fields.map((field) => ({ field, from: before[field] ?? null, to: after[field] ?? null })) },
      });
    }
    return toDto(updated);
  }

  async setLogo(userId: number, upload: Buffer): Promise<BusinessDto> {
    const business = await this.businessOf(userId);
    const mediaId = await this.mediaService.store(business.id, upload, 'logo');
    const updated = await this.businessRepository.update(business.id, { logo_media_id: mediaId });
    await this.mediaService.remove(business.logo_media_id);
    return toDto(updated);
  }

  async removeLogo(userId: number): Promise<BusinessDto> {
    const business = await this.businessOf(userId);
    const updated = await this.businessRepository.update(business.id, { logo_media_id: null });
    await this.mediaService.remove(business.logo_media_id);
    return toDto(updated);
  }

  private async businessOf(userId: number): Promise<BusinessRow> {
    const user = await this.userRepository.findById(userId);
    const business = user ? await this.businessRepository.findById(user.business_id) : undefined;
    if (!business) throw new NotFoundError('No business found for this account');
    return business;
  }
}
