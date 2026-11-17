import type { Request, Response } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { PasskeyService } from '../services/PasskeyService.js';
import { deliverSession } from '../utils/sessionCookies.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  passkeyAddOptionsSchema,
  passkeyAddSchema,
  passkeyRenameSchema,
  passkeySignInSchema,
  passkeyTwoStepOptionsSchema,
  passkeyTwoStepSchema,
} from '../validators/authValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';
import { deviceOf } from './authController.js';

export function createPasskeyController(passkeyService: PasskeyService, refreshTtlDays: number) {
  return {
    async signInOptions(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await passkeyService.signInOptions());
    },

    async signIn(req: Request, res: Response): Promise<void> {
      const { response } = parseInput(passkeySignInSchema, req.body);
      const result = await passkeyService.signIn(response as AuthenticationResponseJSON, deviceOf(req));
      sendSuccess(res, deliverSession(req, res, result, refreshTtlDays), { message: 'Logged in' });
    },

    async twoStepOptions(req: Request, res: Response): Promise<void> {
      const { challenge } = parseInput(passkeyTwoStepOptionsSchema, req.body);
      sendSuccess(res, await passkeyService.twoStepOptions(challenge));
    },

    async twoStep(req: Request, res: Response): Promise<void> {
      const { challenge, response } = parseInput(passkeyTwoStepSchema, req.body);
      const result = await passkeyService.twoStep(challenge, response as AuthenticationResponseJSON, deviceOf(req));
      sendSuccess(res, deliverSession(req, res, result, refreshTtlDays), { message: 'Logged in' });
    },

    async list(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await passkeyService.list(req.user!.id));
    },

    async addOptions(req: Request, res: Response): Promise<void> {
      const proof = parseInput(passkeyAddOptionsSchema, req.body ?? {});
      sendSuccess(res, await passkeyService.addOptions(req.user!.id, proof));
    },

    async add(req: Request, res: Response): Promise<void> {
      const { response } = parseInput(passkeyAddSchema, req.body);
      sendSuccess(res, await passkeyService.add(req.user!.id, response as RegistrationResponseJSON, deviceOf(req)), { message: 'Passkey added' });
    },

    async rename(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { name } = parseInput(passkeyRenameSchema, req.body);
      sendSuccess(res, await passkeyService.rename(req.user!.id, id, name), { message: 'Passkey renamed' });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await passkeyService.remove(req.user!.id, id);
      sendSuccess(res, null, { message: 'Passkey removed' });
    },

    async reset(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await passkeyService.reset(req.user!.id, id), { message: 'Passkeys removed' });
    },
  };
}
