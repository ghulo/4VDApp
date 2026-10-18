import type { Request, Response } from 'express';
import { z } from 'zod';
import { type OpeningService, TYPED_SOURCES } from '../services/OpeningService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { idParamsSchema, idSchema, parseInput } from '../validators/validate.js';

/** On the account's usual side, so it may be below zero (a liability paid ahead). */
const amount = z.coerce.number().min(-100_000_000).max(100_000_000);
const note = z.string().max(300).nullish();

const lineUpdateSchema = z.object({ amount: amount.optional(), source: z.enum(TYPED_SOURCES).optional(), note });
const newLineSchema = z.object({ accountId: idSchema, amount, note });
const confirmSchema = z.object({ ids: z.array(idSchema).min(1).max(1000), confirmed: z.boolean().default(true) });
const takeBackSchema = z.object({ reason: z.string().max(500) });

export function createOpeningController(openingService: OpeningService) {
  return {
    async view(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await openingService.view());
    },

    async updateLine(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await openingService.updateLine(id, parseInput(lineUpdateSchema, req.body), req.user!.id), { message: 'Line saved' });
    },

    async addLine(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await openingService.addAccountLine(parseInput(newLineSchema, req.body), req.user!.id), { statusCode: 201, message: 'Line added' });
    },

    async removeLine(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await openingService.removeLine(id), { message: 'Line removed' });
    },

    async confirm(req: Request, res: Response): Promise<void> {
      const { ids, confirmed } = parseInput(confirmSchema, req.body);
      sendSuccess(res, await openingService.confirm(ids, confirmed, req.user!.id));
    },

    async post(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await openingService.post(req.user!.id), { statusCode: 201, message: 'Opening balances posted' });
    },

    async takeBack(req: Request, res: Response): Promise<void> {
      const { reason } = parseInput(takeBackSchema, req.body);
      sendSuccess(res, await openingService.takeBack(reason, req.user!.id), { message: 'Opening balances taken back' });
    },
  };
}
