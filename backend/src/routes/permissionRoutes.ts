import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { Container } from '../container.js';
import { USER_ROLES } from '../database/types.js';
import { NotFoundError } from '../errors/httpErrors.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { POWERS } from '../utils/roles.js';
import { idSchema, parseInput } from '../validators/validate.js';

const roles = z.array(z.enum(USER_ROLES)).max(USER_ROLES.length);
const permissionsSchema = z.object({
  powers: z.object(Object.fromEntries(POWERS.map((power) => [power, roles.optional()]))).strict(),
  // Menu addresses like "/books" or "/reports/team".
  pages: z.record(z.string().regex(/^\/[a-z0-9/-]{0,60}$/), roles).refine((pages) => Object.keys(pages).length <= 100),
});
const entrySchema = z.object({ id: idSchema });

/** What each role may do (Settings → Roles). Everyone reads it, so their screens match; only the developer changes it. */
export function createPermissionRoutes({ permissionService, guards }: Container): Router {
  const router = Router();

  router.get('/', guards.authenticated, async (_req: Request, res: Response) => {
    sendSuccess(res, await permissionService.get());
  });
  router.put('/', ...guards.developer, async (req: Request, res: Response) => {
    const input = parseInput(permissionsSchema, req.body);
    sendSuccess(res, await permissionService.update(input, req.user!), { message: 'Roles saved' });
  });
  router.get('/history', ...guards.developer, async (_req: Request, res: Response) => {
    sendSuccess(res, await permissionService.history());
  });
  router.post('/history/:id/restore', ...guards.developer, async (req: Request, res: Response) => {
    const { id } = parseInput(entrySchema, { id: Number(req.params.id) });
    const restored = await permissionService.restore(id, req.user!);
    if (!restored) throw new NotFoundError('That change is no longer in the activity log');
    sendSuccess(res, restored, { message: 'Roles put back' });
  });

  return router;
}
