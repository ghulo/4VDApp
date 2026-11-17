import { type Request, type Response, Router } from 'express';
import type { Container } from '../container.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** Settings → Support visits: when someone from 4VD opened this business, and what they changed. */
export function createSupportRoutes({ supportRepository, guards }: Container): Router {
  const router = Router();

  router.get('/', ...guards.leaders, async (_req: Request, res: Response) => {
    const visits = await supportRepository.list();
    sendSuccess(
      res,
      visits.map((visit) => ({
        ...visit,
        startedAt: visit.startedAt.toISOString(),
        lastSeenAt: visit.lastSeenAt.toISOString(),
        actions: visit.actions.map((action) => ({ ...action, at: action.at.toISOString() })),
      })),
    );
  });

  return router;
}
