import type { Request, Response } from 'express';
import type { AuthService } from '../services/AuthService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { loginSchema, logoutSchema, refreshTokenSchema } from '../validators/authValidators.js';
import { parseInput } from '../validators/validate.js';

export function createAuthController(authService: AuthService) {
  return {
    async login(req: Request, res: Response): Promise<void> {
      const { email, password } = parseInput(loginSchema, req.body);
      const result = await authService.login(email, password);
      sendSuccess(res, result, { message: 'Logged in' });
    },

    async refresh(req: Request, res: Response): Promise<void> {
      const { refreshToken } = parseInput(refreshTokenSchema, req.body);
      const tokens = await authService.refresh(refreshToken);
      sendSuccess(res, tokens, { message: 'Session refreshed' });
    },

    async logout(req: Request, res: Response): Promise<void> {
      const { refreshToken } = parseInput(logoutSchema, req.body ?? {});
      await authService.logout(req.user!.id, refreshToken);
      sendSuccess(res, null, { message: 'Logged out' });
    },

    me(req: Request, res: Response): void {
      sendSuccess(res, req.user);
    },
  };
}
