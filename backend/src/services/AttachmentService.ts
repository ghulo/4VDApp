import type { AttachmentEntity } from '../database/types.js';
import { NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { AttachmentRecord, AttachmentRepository } from '../repositories/AttachmentRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { mediaUrl } from './mappers.js';
import type { MediaService } from './MediaService.js';

/** How the shop's history names each kind of record. */
const HISTORY_TYPE = { bill: 'bill', expense: 'expense', document: 'document', offer: 'offer', order: 'order', customer: 'customer', supplier: 'supplier', entry: 'ledger_entry' } as const;

export const ATTACHMENT_ENTITIES: AttachmentEntity[] = ['bill', 'expense', 'document', 'offer', 'order', 'customer', 'supplier', 'entry'];

/** Days a removed file waits in the recycle bin before it is deleted. */
export const BIN_DAYS = 90;

export interface AttachmentDto {
  id: number;
  on: { kind: AttachmentEntity; id: number };
  name: string;
  mime: string;
  size: number;
  url: string;
  addedAt: string;
  addedBy: string | null;
}

export const toAttachmentDto = (row: AttachmentRecord): AttachmentDto => ({
  id: row.id,
  on: { kind: row.entity_type, id: row.entity_id },
  name: row.name,
  mime: row.mime,
  size: row.size,
  url: mediaUrl(row.media_id)!,
  addedAt: row.added_at.toISOString(),
  addedBy: row.added_by_name,
});

/**
 * Files kept on a record: the scanned contract with a customer, a delivery
 * note on an order, a receipt behind a manual entry. Photos are shrunk like
 * bill photos (still readable); PDFs are kept as they are.
 */
export class AttachmentService {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly mediaService: MediaService,
    private readonly transactions: TransactionManager,
  ) {}

  async list(entity: AttachmentEntity, id: number): Promise<AttachmentDto[]> {
    return (await this.repository.list(entity, id)).map(toAttachmentDto);
  }

  async add(entity: AttachmentEntity, id: number, file: { name: string; mime: string; bytes: Buffer }, actorId: number): Promise<AttachmentDto> {
    if (!(await this.repository.exists(entity, id))) throw new NotFoundError(`That ${entity} does not exist`);
    if (file.bytes.length === 0) throw new ValidationError('That file is empty');
    const isPdf = file.mime === 'application/pdf';
    if (!isPdf && !file.mime.startsWith('image/')) throw new ValidationError('Add a PDF or a photo (JPG, PNG or WebP).');
    const mediaId = isPdf ? await this.mediaService.storePdf(null, file.bytes) : await this.mediaService.store(null, file.bytes, 'bill');
    const mime = isPdf ? 'application/pdf' : 'image/webp';
    // A photo becomes WebP; its name says so, so a download opens.
    const name = (isPdf ? file.name : file.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.webp').slice(0, 200) || (isPdf ? 'file.pdf' : 'photo.webp');
    const size = (await this.mediaService.read(mediaId)).bytes.length;
    const attachmentId = await this.transactions.run(async (repos) => {
      const created = await repos.attachments.create({ entity, entityId: id, mediaId, name, mime, size, addedBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'file.added',
        entityType: HISTORY_TYPE[entity],
        entityId: id,
        say: { key: 'fileAdded', params: { name } },
        details: { attachmentId: created, name, mime, size },
      });
      return created;
    });
    return toAttachmentDto((await this.repository.find(attachmentId))!);
  }

  /** Into the recycle bin; it can come back for {@link BIN_DAYS} days. */
  async remove(attachmentId: number, actorId: number, now = new Date()): Promise<void> {
    const file = await this.repository.find(attachmentId);
    if (!file || file.removed_at) throw new NotFoundError('That file is not there');
    await this.transactions.run(async (repos) => {
      await repos.attachments.setRemoved(attachmentId, { at: now, by: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'file.removed',
        entityType: HISTORY_TYPE[file.entity_type],
        entityId: file.entity_id,
        say: { key: 'fileRemoved', params: { name: file.name } },
        details: { attachmentId },
      });
    });
  }

  async restore(attachmentId: number, actorId: number): Promise<AttachmentDto> {
    const file = await this.repository.find(attachmentId);
    if (!file || !file.removed_at) throw new NotFoundError('That file is not in the recycle bin');
    await this.transactions.run(async (repos) => {
      await repos.attachments.setRemoved(attachmentId, null);
      await repos.activityLog.create({
        userId: actorId,
        action: 'file.restored',
        entityType: HISTORY_TYPE[file.entity_type],
        entityId: file.entity_id,
        say: { key: 'fileRestored', params: { name: file.name } },
        details: { attachmentId },
      });
    });
    return toAttachmentDto((await this.repository.find(attachmentId))!);
  }

  /** Deletes files that sat in the bin past {@link BIN_DAYS} days. Safe to run often. */
  async purge(now = new Date()): Promise<number> {
    return this.repository.purge(new Date(now.getTime() - BIN_DAYS * 86_400_000));
  }
}
