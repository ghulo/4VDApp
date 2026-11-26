import { Router, type Request, type Response } from 'express';
import type { Container } from '../container.js';
import { sendSuccess } from '../utils/apiResponse.js';

export interface SetupProgress {
  productCount: number;
  peopleCount: number;
  openInvites: number;
  /** Phones and browsers getting this person's alerts, as the alerts settings count them. */
  alertDevices: number;
}

/**
 * The counts behind Overview's "Get ready" strip, in one small answer. It used
 * to load the product list, the people list and the invites just to count them:
 * four requests on every Overview visit (the alerts settings too), on a database with a tenth of a CPU.
 */
export function createSetupRoutes({ productService, userRepository, inviteService, pushService, guards }: Container): Router {
  const router = Router();

  router.get('/', ...guards.manage, async (req: Request, res: Response) => {
    const [products, people, invites, alerts] = await Promise.all([
      // The same counts the Products and People pages show.
      productService.list({ page: 1, limit: 1 }, req.user!.role),
      userRepository.findAll({ limit: 1, offset: 0 }),
      inviteService.list(req.user!.id),
      pushService.settings(req.user!.id, req.user!.role),
    ]);
    const progress: SetupProgress = { productCount: products.meta.total, peopleCount: people.total, openInvites: invites.length, alertDevices: alerts.deviceCount };
    sendSuccess(res, progress);
  });

  return router;
}
