import type { Request, Response } from 'express';
import type { AuthService, DeviceInfo } from '../services/AuthService.js';
import type { TwoStepService } from '../services/TwoStepService.js';
import { clearSessionCookies, deliverSession, readCookie, REFRESH_COOKIE } from '../utils/sessionCookies.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { loginSchema, logoutSchema, refreshTokenSchema, twoStepCodeSchema, twoStepSignInSchema } from '../validators/authValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

/** What the devices list shows for this browser or phone. */
export function deviceOf(req: Request): DeviceInfo {
  return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
}

export function createAuthController(authService: AuthService, twoStepService: TwoStepService, refreshTtlDays: number) {
  return {
    async login(req: Request, res: Response): Promise<void> {
      const { email, password } = parseInput(loginSchema, req.body);
      const result = await authService.login(email, password, deviceOf(req));
      // With two-step sign-in on, no session yet: the page asks for the code.
      if ('twoStep' in result) sendSuccess(res, result, { message: 'Type the code from your authenticator app' });
      else sendSuccess(res, deliverSession(req, res, result, refreshTtlDays), { message: 'Logged in' });
    },

    async twoStep(req: Request, res: Response): Promise<void> {
      const { challenge, code } = parseInput(twoStepSignInSchema, req.body);
      const result = await twoStepService.finish(challenge, code, deviceOf(req));
      sendSuccess(res, deliverSession(req, res, result, refreshTtlDays), { message: 'Logged in' });
    },

    async twoStepStatus(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await twoStepService.status(req.user!.id));
    },

    async twoStepStart(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await twoStepService.start(req.user!.id));
    },

    async twoStepConfirm(req: Request, res: Response): Promise<void> {
      const { code } = parseInput(twoStepCodeSchema, req.body);
      sendSuccess(res, await twoStepService.confirm(req.user!.id, code), { message: 'Two-step sign-in is on' });
    },

    async twoStepOff(req: Request, res: Response): Promise<void> {
      const { code } = parseInput(twoStepCodeSchema, req.body);
      await twoStepService.turnOff(req.user!.id, code);
      sendSuccess(res, null, { message: 'Two-step sign-in is off' });
    },

    async twoStepBackupCodes(req: Request, res: Response): Promise<void> {
      const { code } = parseInput(twoStepCodeSchema, req.body);
      sendSuccess(res, await twoStepService.renewBackupCodes(req.user!.id, code), { message: 'New backup codes made' });
    },

    async twoStepReset(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await twoStepService.reset(req.user!.id, id);
      sendSuccess(res, null, { message: 'Two-step sign-in reset' });
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
