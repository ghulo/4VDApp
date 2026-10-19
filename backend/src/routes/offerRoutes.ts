import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { Container } from '../container.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { idParamsSchema, paginationSchema, parseInput } from '../validators/validate.js';

const listSchema = paginationSchema.extend({ search: z.string().trim().max(100).optional() });

/** Offers (price quotes): look-only, the money side and the accountant read them. */
export function createOfferRoutes({ offerService, guards }: Container): Router {
  const router = Router();

  router.get('/', ...guards.books, async (req: Request, res: Response) => {
    const { search, ...page } = parseInput(listSchema, req.query);
    const { items, meta } = await offerService.list({ ...page, search: search || undefined });
    sendSuccess(res, items, { meta });
  });
  router.get('/:id', ...guards.books, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await offerService.get(id));
  });

  return router;
}
