import { timingSafeEqual } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import type { Container } from '../container.js';
import { UnauthorizedError } from '../errors/httpErrors.js';
import { sendSuccess } from '../utils/apiResponse.js';

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Calls from our own automation (not from people), each with a shared secret. */
export function createInternalRoutes({ config, launchService }: Container): Router {
  const router = Router();

  // The weekly backup job calls this once the encrypted copy is safely in R2.
  router.post('/backup-ok', async (req: Request, res: Response) => {
    const given = req.header('x-backup-token') ?? '';
    if (!config.backupPingToken || !sameSecret(given, config.backupPingToken)) throw new UnauthorizedError('Wrong or missing backup token');
    await launchService.recordBackup();
    sendSuccess(res, null, { message: 'Backup noted' });
  });

  return router;
}
