import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { Container } from '../container.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

const sendersSchema = z.object({ senders: z.array(z.string().max(254)).max(100) });

/** Bills that came by email and still need someone, and who may send them. Only the people who run the shop. */
export function createBillEmailRoutes({ billEmailService, guards }: Container): Router {
  const router = Router();
  router.use(...guards.oversee);

  router.get('/', async (_req: Request, res: Response) => {
    sendSuccess(res, await billEmailService.open());
  });

  router.get('/settings', async (_req: Request, res: Response) => {
    sendSuccess(res, await billEmailService.settings());
  });

  router.put('/settings', async (req: Request, res: Response) => {
    const { senders } = parseInput(sendersSchema, req.body);
    await billEmailService.setSenders(senders, req.user!.id);
    sendSuccess(res, await billEmailService.settings(), { message: 'Senders saved' });
  });

  router.post('/:id/read', async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await billEmailService.readNow(id));
  });

  router.post('/:id/remove', async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    await billEmailService.remove(id, req.user!.id);
    sendSuccess(res, null, { message: 'Removed' });
  });

  return router;
}
