import type { Request, Response } from 'express';
import type { InviteService } from '../services/InviteService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { acceptInviteSchema, inviteSchema, linkTokenParamsSchema } from '../validators/authValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';
import { deviceOf } from './authController.js';

export function createInviteController(inviteService: InviteService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await inviteService.list(req.user!.id));
    },

    async create(req: Request, res: Response): Promise<void> {
      const { email, role, language } = parseInput(inviteSchema, req.body);
      sendSuccess(res, await inviteService.invite(req.user!.id, email, role, language), { statusCode: 201, message: `Invite sent to ${email}` });
    },

    async resend(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await inviteService.resend(req.user!.id, id), { message: 'Invite sent again' });
    },

    async cancel(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await inviteService.cancel(req.user!.id, id);
      sendSuccess(res, null, { message: 'Invite cancelled' });
    },

    async preview(req: Request, res: Response): Promise<void> {
      const { token } = parseInput(linkTokenParamsSchema, req.params);
      sendSuccess(res, await inviteService.preview(token));
    },

    async accept(req: Request, res: Response): Promise<void> {
      const { token } = parseInput(linkTokenParamsSchema, req.params);
      const input = parseInput(acceptInviteSchema, req.body);
      sendSuccess(res, await inviteService.accept(token, input, deviceOf(req)), { statusCode: 201, message: 'Welcome to 4VD' });
    },
  };
}
