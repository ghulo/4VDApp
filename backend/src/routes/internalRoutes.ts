import { timingSafeEqual } from 'node:crypto';
import { enterBusiness } from '../database/businessContext.js';
import { defaultBusinessId } from '../database/business.js';
import { type Request, type RequestHandler, type Response, Router } from 'express';
import type { AppConfig } from '../config/env.js';
import type { Container } from '../container.js';
import { z } from 'zod';
import { UnauthorizedError } from '../errors/httpErrors.js';
import { parseInput } from '../validators/validate.js';
import { sendSuccess } from '../utils/apiResponse.js';

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Calls from our own automation (not from people), each with a shared secret. */
/** Checked before the large body is read, so nobody without the secret can make the API parse 40 MB. */
export function billEmailTokenGuard(config: AppConfig): RequestHandler {
  return (req, _res, next) => {
    const given = req.header('x-bill-email-token') ?? '';
    if (!config.billEmailToken || !sameSecret(given, config.billEmailToken)) throw new UnauthorizedError('Wrong or missing bill email token');
    next();
  };
}

const billEmailSchema = z.object({
  messageId: z.string().trim().min(1).max(500),
  from: z.string().trim().min(3).max(254),
  subject: z.string().max(500).nullable().default(null),
  files: z
    .array(z.object({ name: z.string().max(500).nullable().default(null), mime: z.string().max(100), data: z.string() }))
    .max(20),
});

export function createInternalRoutes({ config, launchService, billEmailService, db }: Container): Router {
  const router = Router();

  // The weekly backup job calls this once the encrypted copy is safely in R2.
  router.post('/backup-ok', async (req: Request, res: Response) => {
    const given = req.header('x-backup-token') ?? '';
    if (!config.backupPingToken || !sameSecret(given, config.backupPingToken)) throw new UnauthorizedError('Wrong or missing backup token');
    await launchService.recordBackup();
    sendSuccess(res, null, { message: 'Backup noted' });
  });

  // The mail Worker passes on emails to the bill address that passed SPF or DKIM for their sender.
  router.post('/bill-email', billEmailTokenGuard(config), async (req: Request, res: Response) => {
    const mail = parseInput(billEmailSchema, req.body);
    // One bill address for now; phase 5 gives each business its own and picks it from the address.
    enterBusiness(await defaultBusinessId(db));
    sendSuccess(res, await billEmailService.receive(mail), { statusCode: 202, message: 'Email taken' });
  });

  return router;
}
