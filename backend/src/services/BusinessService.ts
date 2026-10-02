import { NotFoundError } from '../errors/httpErrors.js';
import type { BusinessRepository, BusinessRow } from '../repositories/BusinessRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { mediaUrl } from './mappers.js';
import type { MediaService } from './MediaService.js';

export interface BusinessDto {
  name: string;
  address: string | null;
  phone: string | null;
  currency: string;
  timeZone: string | null;
  logoUrl: string | null;
}

export interface BusinessChanges {
  name?: string;
  address?: string | null;
  phone?: string | null;
  timeZone?: string | null;
}

const toDto = (business: BusinessRow): BusinessDto => ({
  name: business.name,
  address: business.address,
  phone: business.phone,
  currency: business.currency,
  timeZone: business.time_zone,
  logoUrl: mediaUrl(business.logo_media_id),
});

/** The shop's own details: name, address, phone, time zone and logo. */
export class BusinessService {
  constructor(
    private readonly businessRepository: BusinessRepository,
    private readonly userRepository: UserRepository,
    private readonly mediaService: MediaService,
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
      ...(changes.timeZone !== undefined && { time_zone: changes.timeZone }),
    });
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
