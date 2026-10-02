import type { Request, Response } from 'express';
import type { AccountService } from '../services/AccountService.js';
import type { SignupService } from '../services/SignupService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  changeEmailSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  linkTokenBodySchema,
  resetPasswordSchema,
  signupSchema,
} from '../validators/authValidators.js';
import { parseInput } from '../validators/validate.js';

const CHECK_INBOX = 'If that email has an account, we sent it a link. Check the inbox (and spam).';

export function createSignupController(signupService: SignupService) {
  return {
    async signup(req: Request, res: Response): Promise<void> {
      const input = parseInput(signupSchema, req.body);
      await signupService.signup(input);
      sendSuccess(res, null, { statusCode: 201, message: `Almost there: we sent a link to ${input.email}. Click it to finish.` });
    },
  };
}

export function createAccountController(accountService: AccountService) {
  return {
    async forgotPassword(req: Request, res: Response): Promise<void> {
      const { email } = parseInput(forgotPasswordSchema, req.body);
      await accountService.forgotPassword(email);
      sendSuccess(res, null, { statusCode: 202, message: CHECK_INBOX });
    },

    async resetPassword(req: Request, res: Response): Promise<void> {
      const { token, password } = parseInput(resetPasswordSchema, req.body);
      await accountService.resetPassword(token, password);
      sendSuccess(res, null, { message: 'Password changed. Log in with your new password.' });
    },

    async resendVerification(req: Request, res: Response): Promise<void> {
      const { email } = parseInput(forgotPasswordSchema, req.body);
      await accountService.resendVerification(email);
      sendSuccess(res, null, { statusCode: 202, message: CHECK_INBOX });
    },

    async verifyEmail(req: Request, res: Response): Promise<void> {
      const { token } = parseInput(linkTokenBodySchema, req.body);
      await accountService.verifyEmail(token);
      sendSuccess(res, null, { message: 'Email confirmed. You can log in now.' });
    },

    async confirmEmailChange(req: Request, res: Response): Promise<void> {
      const { token } = parseInput(linkTokenBodySchema, req.body);
      await accountService.confirmEmailChange(token);
      sendSuccess(res, null, { message: 'Email changed. Log in with your new email.' });
    },

    async changePassword(req: Request, res: Response): Promise<void> {
      const { currentPassword, newPassword } = parseInput(changePasswordSchema, req.body);
      await accountService.changePassword(req.user!.id, currentPassword, newPassword, req.identity?.sessionId);
      sendSuccess(res, null, { message: 'Password changed. Your other devices were logged out.' });
    },

    async changeEmail(req: Request, res: Response): Promise<void> {
      const { password, newEmail } = parseInput(changeEmailSchema, req.body);
      await accountService.requestEmailChange(req.user!.id, password, newEmail);
      sendSuccess(res, null, { statusCode: 202, message: `We sent a link to ${newEmail}. Click it to switch.` });
    },
  };
}
