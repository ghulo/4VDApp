import type { Request, Response } from 'express';
import type { GoogleAuthService } from '../services/GoogleAuthService.js';
import { deliverSession } from '../utils/sessionCookies.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { googleCredentialSchema, googleInviteSchema, linkTokenParamsSchema } from '../validators/authValidators.js';
import { parseInput } from '../validators/validate.js';
import { deviceOf } from './authController.js';

export function createGoogleController(googleAuthService: GoogleAuthService, refreshTtlDays: number) {
  return {
    status(_req: Request, res: Response): void {
      sendSuccess(res, googleAuthService.status());
    },

    async signIn(req: Request, res: Response): Promise<void> {
      const { credential } = parseInput(googleCredentialSchema, req.body);
      const result = await googleAuthService.signIn(credential, deviceOf(req));
      if ('twoStep' in result) sendSuccess(res, result, { message: 'Type the code from your authenticator app' });
      else sendSuccess(res, deliverSession(req, res, result, refreshTtlDays), { message: 'Logged in' });
    },

    async acceptInvite(req: Request, res: Response): Promise<void> {
      const { token } = parseInput(linkTokenParamsSchema, req.params);
      const { credential, language } = parseInput(googleInviteSchema, req.body);
      sendSuccess(res, deliverSession(req, res, await googleAuthService.acceptInvite(token, credential, deviceOf(req), language), refreshTtlDays), {
        statusCode: 201,
        message: 'Welcome to 4VD',
      });
    },

    async security(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await googleAuthService.security(req.user!.id));
    },

    async unlink(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await googleAuthService.unlink(req.user!.id), { message: 'Google sign-in removed' });
    },
  };
}
