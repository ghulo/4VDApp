import type { Request, Response } from 'express';
import { UnauthorizedError } from '../errors/httpErrors.js';
import type { CounterPinService } from '../services/CounterPinService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { pinPeopleQuerySchema, rabatApprovalSchema, setPinSchema, switchSchema } from '../validators/pinValidators.js';
import { parseInput } from '../validators/validate.js';
import { deviceOf } from './authController.js';

export function createCounterPinController(pins: CounterPinService) {
  const actor = (req: Request) => {
    const sessionId = req.identity?.sessionId;
    // Tokens from before sessions were named can't say which PC this is.
    if (!sessionId) throw new UnauthorizedError('Sign in again to use PINs on this PC');
    return { id: req.user!.id, name: req.user!.name, sessionId };
  };
  return {
    async setPin(req: Request, res: Response): Promise<void> {
      const input = parseInput(setPinSchema, req.body);
      sendSuccess(res, await pins.setPin(req.user!.id, input), { message: input.pin === null ? 'PIN removed' : 'PIN saved' });
    },

    async people(req: Request, res: Response): Promise<void> {
      const { approvers } = parseInput(pinPeopleQuerySchema, req.query);
      sendSuccess(res, await pins.people(req.user!.id, approvers));
    },

    async switchTo(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await pins.switchTo(actor(req), parseInput(switchSchema, req.body), deviceOf(req)), { message: 'Switched' });
    },

    async allowRabat(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await pins.allowRabat(actor(req), parseInput(rabatApprovalSchema, req.body)), { statusCode: 201, message: 'Rabat allowed' });
    },
  };
}
