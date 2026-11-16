import type { Request, Response } from 'express';
import type { AuthService, DeviceInfo } from '../services/AuthService.js';
import { clearSessionCookies, deliverSession, readCookie, REFRESH_COOKIE } from '../utils/sessionCookies.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { loginSchema, logoutSchema, refreshTokenSchema } from '../validators/authValidators.js';
import { parseInput } from '../validators/validate.js';

/** What the devices list shows for this browser or phone. */
export function deviceOf(req: Request): DeviceInfo {
  return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
}

export function createAuthController(authService: AuthService, refreshTtlDays: number) {
  return {
    async login(req: Request, res: Response): Promise<void> {
      const { email, password } = parseInput(loginSchema, req.body);
      const result = await authService.login(email, password, deviceOf(req));
      sendSuccess(res, deliverSession(req, res, result, refreshTtlDays), { message: 'Logged in' });
    },

    async refresh(req: Request, res: Response): Promise<void> {
      // The dashboard sends nothing: its refresh token is in the cookie. Scripts send it in the body.
      // (Only our own pages get this far with a cookie: refuseForeignOrigins runs first.)
      const { refreshToken } = parseInput(refreshTokenSchema, { refreshToken: req.body?.refreshToken ?? readCookie(req, REFRESH_COOKIE) ?? undefined });
      const tokens = await authService.refresh(refreshToken, deviceOf(req)).catch((error: unknown) => {
        clearSessionCookies(res);
        throw error;
      });
      sendSuccess(res, deliverSession(req, res, tokens, refreshTtlDays), { message: 'Session refreshed' });
    },

    async logout(req: Request, res: Response): Promise<void> {
      const { refreshToken } = parseInput(logoutSchema, { refreshToken: req.body?.refreshToken ?? readCookie(req, REFRESH_COOKIE) ?? undefined });
      await authService.logout(req.user!.id, refreshToken);
      clearSessionCookies(res);
      sendSuccess(res, null, { message: 'Logged out' });
    },

    me(req: Request, res: Response): void {
      sendSuccess(res, req.user);
    },
  };
}
