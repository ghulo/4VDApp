import type { Request, Response } from 'express';
import { z } from 'zod';
import type { SessionService } from '../services/SessionService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { parseInput } from '../validators/validate.js';

const sessionParamsSchema = z.object({ sessionId: z.uuid() });

export function createSessionController(sessionService: SessionService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await sessionService.list(req.user!.id, req.identity?.sessionId));
    },

    async end(req: Request, res: Response): Promise<void> {
      const { sessionId } = parseInput(sessionParamsSchema, req.params);
      await sessionService.end(req.user!.id, sessionId);
      sendSuccess(res, null, { message: 'That device was logged out' });
    },

    async endOthers(req: Request, res: Response): Promise<void> {
      await sessionService.endOthers(req.user!.id, req.identity?.sessionId);
      sendSuccess(res, null, { message: 'Every other device was logged out' });
    },
  };
}
