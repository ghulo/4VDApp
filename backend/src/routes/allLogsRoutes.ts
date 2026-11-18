import { type Request, type Response, Router } from 'express';
import type { Container } from '../container.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { allActivityQuerySchema, allSupportQuerySchema } from '../validators/activityValidators.js';
import { parseInput } from '../validators/validate.js';

/**
 * All logs: 4VD's developer only. The database functions behind it check the
 * developer flag again and log each read; the user they are given is always
 * the signed-in one (requireAuth re-reads it from the database), never a
 * value from the request.
 */
export function createAllLogsRoutes({ allLogsService, guards }: Container): Router {
  const router = Router();

  router.get('/activity', ...guards.developer, async (req: Request, res: Response) => {
    const { action, exclude, ...query } = parseInput(allActivityQuerySchema, req.query);
    const { items, meta } = await allLogsService.activity(req.user!, { ...query, actions: action, excludeActions: exclude });
    sendSuccess(res, items, { meta });
  });

  router.get('/support', ...guards.developer, async (req: Request, res: Response) => {
    const { items, meta } = await allLogsService.support(req.user!, parseInput(allSupportQuerySchema, req.query));
    sendSuccess(res, items, { meta });
  });

  router.get('/businesses', ...guards.developer, async (_req: Request, res: Response) => {
    sendSuccess(res, await allLogsService.businesses());
  });

  return router;
}
