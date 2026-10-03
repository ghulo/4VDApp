import type { UserRepository } from '../repositories/UserRepository.js';
import { NotFoundError } from '../errors/httpErrors.js';
import type { PublicUser } from '../types/auth.js';
import type { Language } from '../i18n/language.js';
import { toPublicUser } from './mappers.js';
import type { MediaService } from './MediaService.js';

export interface ProfileChanges {
  name?: string;
  phone?: string | null;
  theme?: 'light' | 'dark' | 'system';
  language?: Language;
  emailWeeklyReport?: boolean;
}

/** The signed-in person's own name, phone, photo, theme and language. */
export class ProfileService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly mediaService: MediaService,
  ) {}

  async update(userId: number, changes: ProfileChanges): Promise<PublicUser> {
    const user = await this.userRepository.update(userId, {
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.phone !== undefined && { phone: changes.phone }),
      ...(changes.theme !== undefined && { theme: changes.theme }),
      ...(changes.language !== undefined && { language: changes.language }),
      ...(changes.emailWeeklyReport !== undefined && { email_weekly_report: changes.emailWeeklyReport }),
    });
    if (!user) throw new NotFoundError(`User ${userId} does not exist`);
    return toPublicUser(user);
  }

  async setAvatar(userId: number, upload: Buffer): Promise<PublicUser> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError(`User ${userId} does not exist`);
    const mediaId = await this.mediaService.store(user.business_id, upload, 'avatar');
    const updated = await this.userRepository.update(userId, { avatar_media_id: mediaId });
    await this.mediaService.remove(user.avatar_media_id);
    return toPublicUser(updated!);
  }

  async removeAvatar(userId: number): Promise<PublicUser> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError(`User ${userId} does not exist`);
    const updated = await this.userRepository.update(userId, { avatar_media_id: null });
    await this.mediaService.remove(user.avatar_media_id);
    return toPublicUser(updated!);
  }
}
