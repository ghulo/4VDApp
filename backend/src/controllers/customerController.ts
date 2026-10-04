import type { Request, Response } from 'express';
import type { TabService } from '../services/TabService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { customerSchema, tabPaymentSchema } from '../validators/customerValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createCustomerController(tabService: TabService) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await tabService.list());
    },

    async detail(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await tabService.detail(id));
    },

    async create(req: Request, res: Response): Promise<void> {
      const customer = await tabService.create(parseInput(customerSchema, req.body), req.user!.id);
      sendSuccess(res, customer, { statusCode: 201, message: 'Tab opened' });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await tabService.update(id, parseInput(customerSchema, req.body), req.user!.id));
    },

    async archive(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await tabService.archive(id, req.user!.id);
      sendSuccess(res, null, { message: 'Tab closed' });
    },

    async pay(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await tabService.pay(id, parseInput(tabPaymentSchema, req.body), req.user!.id), { message: 'Payment taken' });
    },
  };
}
