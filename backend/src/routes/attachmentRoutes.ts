import express, { type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { AttachmentEntity } from '../database/types.js';
import { ValidationError } from '../errors/httpErrors.js';
import { ATTACHMENT_ENTITIES } from '../services/AttachmentService.js';
import type { BinKind } from '../services/BinService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

/** A file arrives as the raw body, its name in a header; over 10 MB is refused with 413. */
const readFile = express.raw({ type: ['image/*', 'application/pdf'], limit: '10mb' });

const BIN_KINDS: BinKind[] = ['product', 'supplier', 'customer', 'expense', 'file'];
const binParams = z.object({ kind: z.enum(BIN_KINDS as [BinKind, ...BinKind[]]), id: z.coerce.number().int().positive() });

/**
 * Files on records. Each kind of record keeps the guard of its own page, so
 * someone who can't open a bill can't see the files on it either.
 */
export function createAttachmentRoutes({ attachmentService, guards }: Container): Router {
  const router = Router();
  const readGuard: Record<AttachmentEntity, RequestHandler[]> = {
    bill: guards.books,
    expense: guards.books,
    document: guards.books,
    order: guards.books,
    supplier: guards.books,
    entry: guards.books,
    customer: guards.customers,
    offer: guards.staff,
  };

  for (const entity of ATTACHMENT_ENTITIES) {
    router.get(`/${entity}/:id`, ...readGuard[entity], async (req: Request, res: Response) => {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await attachmentService.list(entity, id));
    });
    router.post(`/${entity}/:id`, ...readGuard[entity], readFile, async (req: Request, res: Response) => {
      const { id } = parseInput(idParamsSchema, req.params);
      if (!Buffer.isBuffer(req.body)) throw new ValidationError('Send a PDF or a photo as the request body');
      const header = req.get('x-file-name');
      const name = header ? decodeURIComponent(header).trim() : '';
      const mime = (req.get('content-type') ?? '').split(';')[0]!.trim();
      sendSuccess(res, await attachmentService.add(entity, id, { name: name || 'file', mime, bytes: req.body }, req.user!.id), { statusCode: 201, message: 'File added' });
    });
  }
  router.delete('/:id', ...guards.manage, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    await attachmentService.remove(id, req.user!.id);
    sendSuccess(res, null, { message: 'File moved to the recycle bin' });
  });

  return router;
}

/** The recycle bin, for managers. */
export function createBinRoutes({ binService, guards }: Container): Router {
  const router = Router();
  router.get('/', ...guards.manage, async (_req: Request, res: Response) => {
    sendSuccess(res, await binService.list());
  });
  router.post('/:kind/:id/restore', ...guards.manage, async (req: Request, res: Response) => {
    const { kind, id } = parseInput(binParams, req.params);
    await binService.restore(kind, id, req.user!.id);
    sendSuccess(res, null, { message: 'Put back' });
  });
  return router;
}
