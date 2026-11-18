import { timingSafeEqual } from 'node:crypto';
import { enterBusiness } from '../database/businessContext.js';
import { defaultBusinessId, forEachBusiness } from '../database/business.js';
import { type Request, type RequestHandler, type Response, Router } from 'express';
import type { AppConfig } from '../config/env.js';
import type { Container } from '../container.js';
import { z } from 'zod';
import { AppError, UnauthorizedError } from '../errors/httpErrors.js';
import { runAsSystem } from '../database/businessContext.js';
import type { DatabaseClient } from '../database/connection.js';
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
  /** The address it was sent to: bills+<short>@4vd.app picks the business; plain bills@ (or none, from an older worker) is the first one. */
  to: z.string().trim().max(254).optional(),
  subject: z.string().max(500).nullable().default(null),
  files: z
    .array(z.object({ name: z.string().max(500).nullable().default(null), mime: z.string().max(100), data: z.string() }))
    .max(20),
});

/** Unknown short name: the worker tells the sender no business uses the address. */
export const UNKNOWN_BILL_ADDRESS = 'UNKNOWN_BILL_ADDRESS';

/** bills+<short>@… → that business; bills@… or no address → the first business. */
export async function businessForBillAddress(db: DatabaseClient, to: string | undefined): Promise<number> {
  const tag = /^[^+@]+\+([^@]+)@/.exec(to?.toLowerCase() ?? '')?.[1];
  if (!tag) return defaultBusinessId(db);
  const row = await runAsSystem(() => db.selectFrom('businesses').select('id').where('short_name', '=', tag).executeTakeFirst());
  if (!row) throw new AppError(`No business uses the bill address ${to}`, 404, UNKNOWN_BILL_ADDRESS);
  return row.id;
}

export function createInternalRoutes({ config, launchService, billEmailService, db }: Container): Router {
  const router = Router();

  // The weekly backup job calls this once the encrypted copy is safely in R2.
  router.post('/backup-ok', async (req: Request, res: Response) => {
    const given = req.header('x-backup-token') ?? '';
    if (!config.backupPingToken || !sameSecret(given, config.backupPingToken)) throw new UnauthorizedError('Wrong or missing backup token');
    // The backup covers the whole server: every business's launch step sees it.
    await forEachBusiness(db, () => launchService.recordBackup());
    sendSuccess(res, null, { message: 'Backup noted' });
  });

  // The mail Worker passes on emails to the bill address that passed SPF or DKIM for their sender.
  router.post('/bill-email', billEmailTokenGuard(config), async (req: Request, res: Response) => {
    const mail = parseInput(billEmailSchema, req.body);
    enterBusiness(await businessForBillAddress(db, mail.to));
    sendSuccess(res, await billEmailService.receive(mail), { statusCode: 202, message: 'Email taken' });
  });

  return router;
}
