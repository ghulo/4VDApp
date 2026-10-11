import sharp from 'sharp';
import { NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { MediaRepository } from '../repositories/MediaRepository.js';

/** Longest side in pixels for each kind of picture. */
// A bill photo stays big enough to read the small print.
const SIZES = { avatar: 256, logo: 512, product: 800, bill: 1600 } as const;
export type MediaKind = keyof typeof SIZES;

/**
 * Small pictures (profile photos, the shop logo, product photos), shrunk to WebP and kept in
 * the database. Enough for one shop; moves to file storage if 4VD becomes a
 * product for many shops.
 */
export class MediaService {
  constructor(private readonly mediaRepository: MediaRepository) {}

  async store(businessId: number | null, upload: Buffer, kind: MediaKind): Promise<string> {
    let bytes: Buffer;
    try {
      bytes = await sharp(upload, { limitInputPixels: 50_000_000 })
        .rotate() // respect the phone's orientation flag
        .resize(SIZES[kind], SIZES[kind], { fit: kind === 'avatar' ? 'cover' : 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new ValidationError("That file isn't a picture we can read. Use a JPG, PNG or WebP.");
    }
    return this.mediaRepository.create({ businessId, mime: 'image/webp', bytes });
  }

  /** A supplier's bill sent as a PDF, kept as it is so every page stays readable. */
  async storePdf(businessId: number | null, upload: Buffer): Promise<string> {
    if (upload.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ValidationError("That file isn't a PDF we can read.");
    return this.mediaRepository.create({ businessId, mime: 'application/pdf', bytes: upload });
  }

  async read(id: string): Promise<{ mime: string; bytes: Buffer }> {
    const media = await this.mediaRepository.findById(id);
    if (!media) throw new NotFoundError('That picture does not exist');
    return media;
  }

  async mimes(ids: string[]): Promise<Map<string, string>> {
    return this.mediaRepository.findMimes(ids);
  }

  async remove(id: string | null): Promise<void> {
    if (id) await this.mediaRepository.delete(id);
  }
}
